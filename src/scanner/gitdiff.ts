import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ComparisonRequest, GitRef, RepositoryRefs, SnapshotBacklink } from "../shared/api.ts";

const execFileAsync = promisify(execFile);

/** Where one side of a comparison reads its content from. */
export type DiffSide =
  | { kind: "revision"; rev: string }
  | { kind: "index" }
  | { kind: "worktree" };

/** What the command line asked to compare, resolved against a repository. */
export interface Comparison {
  /** The comparison as it would be named on the command line. */
  spec: string;
  /** What was asked for, echoed so the page can open its picker on it. */
  request: ComparisonRequest;
  base: DiffSide;
  target: DiffSide;
  baseLabel: string;
  targetLabel: string;
  /** Arguments that select this comparison for `git diff`. */
  diffArguments: string[];
}

export class GitError extends Error {}

/** What a failed command said on stderr, or the thrown value when it said nothing. */
function failureDetail(cause: unknown): string {
  const stderr = cause instanceof Error && "stderr" in cause ? String(cause.stderr).trim() : "";
  return stderr || String(cause);
}

async function git(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8", ...(env ? { env } : {}),
    });
    return stdout;
  } catch (cause) {
    throw new GitError(`git ${args.join(" ")} failed: ${failureDetail(cause)}`);
  }
}

/**
 * The top of the worktree holding `directory`.
 *
 * Diff mode reports paths from there, so this is also the scan root, and a
 * file lands in the same place on the map in either mode.
 */
export async function repositoryRoot(directory: string): Promise<string> {
  try {
    return (await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" }))
      .stdout.trim();
  } catch {
    throw new GitError(`not inside a Git repository: ${directory}. Diff mode needs one; name another with -C <dir>`);
  }
}

/** Whether Git accepts `candidate` as naming a commit in this repository. */
export async function isRevision(directory: string, candidate: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { cwd: directory });
    return true;
  } catch {
    return false;
  }
}

/**
 * A raw object name, which is the one way of naming a revision that says
 * nothing about where it sits.
 *
 * Somebody who types `origin/main` names a place to measure from. Somebody who
 * pastes a commit means that commit, because a bare object name arrives from a
 * log, a review page, or another tool, and never from a person describing how
 * far back to look.
 */
const OBJECT_NAME = /^[0-9a-f]{7,64}$/i;

/**
 * Split a revision argument on its range operator.
 *
 * `A...B` compares B against the merge base, which is what a pull request
 * shows, and `A..B` compares A to B directly, matching `git diff A B`.
 * `A^!` is Git's own notation for one commit against its parent.
 */
export function parseRevisionArgument(argument: string): ComparisonRequest | null {
  if (argument.length > 2 && argument.endsWith("^!")) {
    const rev = argument.slice(0, -2);
    return { kind: "revisionPair", base: `${rev}^`, target: rev };
  }
  const tripleDot = argument.indexOf("...");
  if (tripleDot > 0 && tripleDot + 3 < argument.length) {
    return { kind: "mergeBase", base: argument.slice(0, tripleDot), target: argument.slice(tripleDot + 3) };
  }
  const doubleDot = argument.indexOf("..");
  if (doubleDot > 0 && doubleDot + 2 < argument.length && !argument.includes("...")) {
    return { kind: "revisionPair", base: argument.slice(0, doubleDot), target: argument.slice(doubleDot + 2) };
  }
  return null;
}

/**
 * Read a comparison out of command-line tokens.
 *
 * Text is the command line's own problem: the page builds a
 * `ComparisonRequest` from its picker instead. What both share is
 * {@link verifyComparisonRequest}, so one place decides whether a revision
 * exists. The directory rule stays with the caller, because only a positional
 * slot can hold a folder.
 */
export function parseComparisonSpec(tokens: readonly string[]): ComparisonRequest {
  if (tokens.length === 0) throw new GitError("name what to compare");
  if (tokens.length > 2) throw new GitError(`expected at most two revisions, got ${tokens.length}`);

  if (tokens.length === 2) {
    const [base, target] = tokens as [string, string];
    return { kind: "revisionPair", base, target };
  }

  const only = tokens[0]!;
  if (only === "--diff") return { kind: "workingTree" };
  if (only === "--staged") return { kind: "staged" };
  const range = parseRevisionArgument(only);
  if (range !== null) return range;
  return OBJECT_NAME.test(only)
    ? { kind: "revisionPair", base: `${only}^`, target: only }
    : { kind: "revisionToWorkingTree", rev: only };
}

/** Every revision a request names, in the order a reader would meet them. */
function revisionsOf(request: ComparisonRequest): string[] {
  switch (request.kind) {
    case "workingTree": case "staged": return [];
    case "revisionToWorkingTree": return [request.rev];
    case "revisionPair": case "mergeBase": return [request.base, request.target];
  }
}

/**
 * Reject a request naming something this repository does not hold.
 *
 * Both producers of a request run this, so the command line and the page
 * refuse the same names and say the same thing about them.
 */
export async function verifyComparisonRequest(directory: string, request: ComparisonRequest): Promise<void> {
  for (const candidate of revisionsOf(request)) {
    if (!(await isRevision(directory, candidate))) {
      throw new GitError(`not a revision in this repository: ${candidate}`);
    }
  }
}

async function shortName(directory: string, rev: string): Promise<string> {
  return (await git(directory, ["rev-parse", "--short", rev])).trim();
}

/** The whole object name of the commit a revision names. */
async function commitName(directory: string, rev: string): Promise<string> {
  return (await git(directory, ["rev-parse", `${rev}^{commit}`])).trim();
}

/** Resolve a requested comparison into concrete sides and `git diff` arguments. */
export async function resolveComparison(directory: string, request: ComparisonRequest): Promise<Comparison> {
  switch (request.kind) {
    case "workingTree":
      return {
        spec: "--diff",
        request,
        base: { kind: "revision", rev: "HEAD" },
        target: { kind: "worktree" },
        baseLabel: "HEAD",
        targetLabel: "working tree",
        diffArguments: ["HEAD"],
      };
    case "staged":
      return {
        spec: "--staged",
        request,
        base: { kind: "revision", rev: "HEAD" },
        target: { kind: "index" },
        baseLabel: "HEAD",
        targetLabel: "index",
        diffArguments: ["--cached", "HEAD"],
      };
    case "revisionToWorkingTree":
      return {
        spec: request.rev,
        request,
        base: { kind: "revision", rev: request.rev },
        target: { kind: "worktree" },
        baseLabel: request.rev,
        targetLabel: "working tree",
        diffArguments: [request.rev],
      };
    case "revisionPair": {
      // Two names for one commit describe an empty change, and an empty change
      // is refused here rather than measured and served as a blank page.
      if (await commitName(directory, request.base) === await commitName(directory, request.target)) {
        throw new GitError(
          `nothing to compare: ${request.base} and ${request.target} are the same commit`,
        );
      }
      return {
        spec: `${request.base}..${request.target}`,
        request,
        base: { kind: "revision", rev: request.base },
        target: { kind: "revision", rev: request.target },
        baseLabel: request.base,
        targetLabel: request.target,
        diffArguments: [request.base, request.target],
      };
    }
    case "mergeBase": {
      const mergeBase = (await git(directory, ["merge-base", request.base, request.target])).trim();
      if (!mergeBase) throw new GitError(`no merge base between ${request.base} and ${request.target}`);
      if (mergeBase === await commitName(directory, request.target)) {
        throw new GitError(
          `nothing to compare: ${request.target} is an ancestor of ${request.base}, `
          + `so ${request.base}...${request.target} is empty`,
        );
      }
      return {
        spec: `${request.base}...${request.target}`,
        request,
        base: { kind: "revision", rev: mergeBase },
        target: { kind: "revision", rev: request.target },
        baseLabel: `${await shortName(directory, mergeBase)} (merge base with ${request.base})`,
        targetLabel: request.target,
        diffArguments: [`${request.base}...${request.target}`],
      };
    }
  }
}

/**
 * Git's empty tree.
 *
 * A commit with no parent still has a change, and this is the side it is
 * measured against.
 */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** One commit against its own first parent, which is how the spine measures one. */
export function commitComparison(sha: string, base: string): Comparison {
  return {
    spec: `${base}..${sha}`,
    request: { kind: "revisionPair", base, target: sha },
    base: { kind: "revision", rev: base },
    target: { kind: "revision", rev: sha },
    baseLabel: base,
    targetLabel: sha,
    diffArguments: [base, sha],
  };
}

/** One revision against the current working tree. */
export function workingTreeComparison(base: string): Comparison {
  return {
    spec: base,
    request: { kind: "revisionToWorkingTree", rev: base },
    base: { kind: "revision", rev: base },
    target: { kind: "worktree" },
    baseLabel: base,
    targetLabel: "working tree",
    diffArguments: [base],
  };
}

/** How many commits a spine holds. Past this it lists the newest and says how many it left. */
const MAX_SPINE_COMMITS = 200;

/** One commit as the spine lists it, before it is measured. */
export interface SpineCommit {
  sha: string;
  shortSha: string;
  subject: string;
  /** The message under the subject, trimmed. Empty when there is none. */
  body: string;
  author: string;
  authorEmail: string;
  date: string;
  /** First parent, and the empty tree for a commit that has none. */
  parent: string;
}

/** Git writes `%x1f` as this byte, which no commit message can hold. */
const SPINE_SEPARATOR = "\u001F";

/** The message runs to the end of a record, so records end with a byte of their own. */
const SPINE_TERMINATOR = "\u0000";

const SPINE_FORMAT = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%B%x00";

/**
 * How much of a commit message the band carries.
 *
 * Enough for the paragraph that explains a commit, and not so much that a
 * generated body of a hundred lines travels to the browser for every commit in
 * a range.
 */
const MAX_COMMIT_BODY = 400;

/** The message under the subject line, trimmed to what a tooltip can hold. */
function commitBody(message: string): string {
  const body = message.split("\n").slice(1).join("\n").trim();
  return body.length > MAX_COMMIT_BODY ? `${body.slice(0, MAX_COMMIT_BODY).trimEnd()}...` : body;
}

/**
 * The commits between the two sides of a comparison, oldest first.
 *
 * A working-tree comparison lists the commits up to HEAD and names HEAD as the
 * parent of its final uncommitted entry. An index comparison has no spine.
 * Merges are left out: a merge holds no change of its own, and a span whose end
 * was one would compare against a commit the list does not draw.
 */
export async function listSpineCommits(
  directory: string, comparison: Comparison,
): Promise<{ commits: SpineCommit[]; omitted: number; workingTreeParent: string | null } | null> {
  if (comparison.base.kind !== "revision" || comparison.target.kind === "index") return null;

  const target = comparison.target.kind === "revision"
    ? comparison.target.rev
    : await commitName(directory, "HEAD");
  const workingTreeParent = comparison.target.kind === "worktree" ? target : null;

  const range = `${comparison.base.rev}..${target}`;
  const total = Number((await git(directory, ["rev-list", "--no-merges", "--count", range])).trim());
  const stdout = await git(directory, [
    "log", "--no-merges", "--reverse", `--max-count=${MAX_SPINE_COMMITS}`, `--format=${SPINE_FORMAT}`, range,
  ]);

  const commits: SpineCommit[] = [];
  for (const record of stdout.split(SPINE_TERMINATOR)) {
    // Git writes a newline between records, after the terminator.
    const trimmed = record.replace(/^\n/, "");
    if (trimmed === "") continue;
    const [sha, shortSha, author, authorEmail, date, parents, message] = trimmed.split(SPINE_SEPARATOR);
    if (sha === undefined || shortSha === undefined || author === undefined || authorEmail === undefined
      || date === undefined || parents === undefined || message === undefined) continue;
    const firstParent = parents.split(" ").filter(Boolean)[0];
    commits.push({
      sha,
      shortSha,
      author,
      authorEmail,
      date,
      subject: message.split("\n")[0]?.trim() ?? "",
      body: commitBody(message),
      parent: firstParent ?? EMPTY_TREE,
    });
  }
  return { commits, omitted: Math.max(0, total - commits.length), workingTreeParent };
}

/** Newest first, and enough for any picker. A ref beyond this is reachable by typing. */
const MAX_REFS = 1000;

const REF_KINDS: readonly { prefix: string; kind: GitRef["kind"] }[] = [
  { prefix: "refs/heads/", kind: "branch" },
  { prefix: "refs/remotes/", kind: "remote" },
  { prefix: "refs/tags/", kind: "tag" },
];

/**
 * Branches, remote branches, and tags, newest first.
 *
 * Ordered by commit date rather than by name, because the branch somebody
 * wants to compare is nearly always one they touched recently.
 */
export async function listRefs(directory: string): Promise<RepositoryRefs> {
  const stdout = await git(directory, [
    "for-each-ref",
    `--count=${MAX_REFS}`,
    "--sort=-creatordate",
    "--format=%(refname)\t%(objectname:short)",
    "refs/heads", "refs/remotes", "refs/tags",
  ]);
  const refs: GitRef[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const refName = line.slice(0, tab);
    const shortSha = line.slice(tab + 1);
    const match = REF_KINDS.find((candidate) => refName.startsWith(candidate.prefix));
    if (match === undefined) continue;
    const name = refName.slice(match.prefix.length);
    // `origin/HEAD` is a symbolic ref onto a branch already in this list.
    if (match.kind === "remote" && name.endsWith("/HEAD")) continue;
    refs.push({ name, kind: match.kind, shortSha });
  }

  const headBranch = (await git(directory, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return {
    headBranch: headBranch === "HEAD" ? null : headBranch,
    headSha: await shortName(directory, "HEAD"),
    refs,
  };
}

/**
 * Talking to a remote never waits on a terminal.
 *
 * `execFile` gives Git no console, so a credential prompt would hang with
 * nothing on screen to explain it. Refusing to prompt makes that an error the
 * caller can print instead.
 */
const NO_TERMINAL_PROMPT: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

/** A project, as either a remote URL or a web URL names it. */
interface Project {
  host: string;
  /** Folded, because two spellings of one project must match. */
  path: string;
  /** As written, because a link is followed rather than compared. */
  webPath: string;
}

/** Where a pull request lives. `project` is null when only a number was named. */
export interface PullRequestLocation {
  number: number;
  project: Project | null;
}

const PULL_REQUEST_URL = /^https?:\/\/([^/]+)\/(.+?)\/(?:-\/)?(pull|merge_requests)\/(\d+)(?:[/?#].*)?$/;

interface PullRequestPage {
  location: PullRequestLocation;
  route: "pull" | "merge_requests";
}

function parsePullRequestPage(argument: string): PullRequestPage | null {
  const match = PULL_REQUEST_URL.exec(argument);
  if (match === null) return null;
  return {
    location: { number: Number(match[4]), project: projectAt(match[1]!, match[2]!) },
    route: match[3] === "merge_requests" ? "merge_requests" : "pull",
  };
}

function trimProjectPath(rawPath: string): string {
  return rawPath.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
}

function projectAt(host: string, rawPath: string): Project {
  const webPath = trimProjectPath(rawPath);
  return { host: host.toLowerCase(), path: webPath.toLowerCase(), webPath };
}

/**
 * Read a pull request out of a web URL.
 *
 * GitHub writes `.../pull/12` and GitLab writes `.../-/merge_requests/12`. The
 * number and the project are everything either of them has to say.
 */
export function parsePullRequestUrl(argument: string): PullRequestLocation | null {
  return parsePullRequestPage(argument)?.location ?? null;
}

/** Keep a full review-page URL for the static snapshot that it names. */
export function pullRequestBacklink(argument: string): SnapshotBacklink | null {
  const page = parsePullRequestPage(argument);
  if (page === null) return null;
  return {
    label: page.route === "merge_requests" ? `MR !${page.location.number}` : `PR #${page.location.number}`,
    url: argument,
  };
}

/** Host and project of a remote URL, in either shape Git accepts. */
function projectOf(remoteUrl: string): Project | null {
  const scp = /^[^/]+@([^:]+):(.+)$/.exec(remoteUrl);
  if (scp !== null) return projectAt(scp[1]!, scp[2]!);
  const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(remoteUrl);
  if (url !== null) return projectAt(url[1]!, url[2]!);
  return null;
}

/**
 * The URL a remote is configured with.
 *
 * Read from the config rather than through `git remote get-url`, which applies
 * `insteadOf` and would answer with the mirror a fetch is rewritten to. What
 * names the project is what the person wrote.
 */
async function remoteUrl(directory: string, remote: string): Promise<string> {
  return (await git(directory, ["config", "--get", `remote.${remote}.url`])).trim();
}

/** Every remote this repository is configured with. */
async function listRemotes(directory: string): Promise<string[]> {
  return (await git(directory, ["remote"])).split("\n").map((line) => line.trim()).filter(Boolean);
}

/** The remote a repository is read from: `origin`, or its only one. */
async function defaultRemote(directory: string): Promise<string | null> {
  const names = await listRemotes(directory);
  if (names.includes("origin")) return "origin";
  return names[0] ?? null;
}

/**
 * Where a commit of this repository can be read on the web, with the object
 * name to append, or `null` when the remote is not a web forge.
 *
 * GitLab writes `/-/commit/<sha>` and every other forge writes `/commit/<sha>`,
 * and the host name decides which, because a remote publishes no way to ask.
 * Guessing is safe here in a way it is not for a fetch: the worst a wrong guess
 * does is offer a link that does not open, and nothing measured depends on it.
 */
export async function commitUrlBase(directory: string): Promise<string | null> {
  const remote = await defaultRemote(directory);
  if (remote === null) return null;
  const project = projectOf(await remoteUrl(directory, remote));
  if (project === null) return null;
  const commitPath = project.host.includes("gitlab") ? "-/commit" : "commit";
  return `https://${project.host}/${project.webPath}/${commitPath}/`;
}

/** Where a pull request is fetched into, and measured from. */
export interface PullRequestWorkspace {
  /** Repository the head lands in. It is the scan root the comparison reports paths from. */
  directory: string;
  /** Remote of that repository which publishes the request. */
  remote: string;
  /** Project that remote serves, which is what the forge is asked about. */
  project: Project;
  /**
   * Folder to remove when the run ends, or `null` when a repository already on
   * this machine served the request.
   */
  temporaryClone: string | null;
}

/**
 * The repository at hand, when the remote it is read from can be asked.
 *
 * A number names no project, so the remote a repository is read from is the
 * only candidate there is.
 */
async function workspaceForNumber(directory: string): Promise<PullRequestWorkspace> {
  let root: string;
  try {
    root = await repositoryRoot(directory);
  } catch {
    throw new GitError(
      `a --pr number is fetched from this repository's remote, and ${directory} is inside no repository. `
      + "Name the pull request by the URL of its page to review one from anywhere",
    );
  }
  const names = await listRemotes(root);
  if (names.length === 0) throw new GitError("this repository has no remote to fetch a pull request from");
  const remote = names.includes("origin") ? "origin" : names.length === 1 ? names[0]! : null;
  if (remote === null) {
    throw new GitError('this repository has no "origin", so name the pull request by its URL instead');
  }
  const project = projectOf(await remoteUrl(root, remote));
  if (project === null) throw new GitError(`the ${remote} remote names no project to ask about`);
  return { directory: root, remote, project, temporaryClone: null };
}

/**
 * The repository at hand, when one of its remotes serves the project a URL
 * names, and `null` when none of them does.
 */
async function workspaceForProject(directory: string, wanted: Project): Promise<PullRequestWorkspace | null> {
  let root: string;
  try {
    root = await repositoryRoot(directory);
  } catch {
    return null;
  }
  for (const name of await listRemotes(root)) {
    const project = projectOf(await remoteUrl(root, name));
    if (project !== null && project.host === wanted.host && project.path === wanted.path) {
      return { directory: root, remote: name, project, temporaryClone: null };
    }
  }
  return null;
}

/** Where a project is cloned from when this machine holds no checkout of it. */
function cloneUrlOf(project: Project): string {
  return `https://${project.host}/${project.webPath}.git`;
}

/**
 * Clone a project no repository here serves.
 *
 * The clone is blobless, so what travels is the shape of the history rather
 * than every version of every file, and it takes no checkout, because the
 * revision worth checking out is the request head that is fetched next.
 *
 * The folder under the temporary directory carries the project name, because
 * the page draws the root by the name of its folder.
 */
async function cloneProject(project: Project, url: string): Promise<PullRequestWorkspace> {
  const temporaryClone = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-pr-"));
  const directory = path.join(temporaryClone, project.webPath.split("/").pop() || project.host);
  try {
    await git(
      temporaryClone,
      ["clone", "--quiet", "--filter=blob:none", "--no-checkout", url, directory],
      NO_TERMINAL_PROMPT,
    );
  } catch (cause) {
    // The caller never learns this folder, so a clone that fails removes it here
    // or nobody ever does.
    await rm(temporaryClone, { recursive: true, force: true });
    throw cause;
  }
  return { directory, remote: "origin", project, temporaryClone };
}

/**
 * Where this pull request can be fetched and measured.
 *
 * A repository whose remote serves the project is the one to use, because it
 * holds the history already. Nothing else on this machine can serve it, so a
 * URL naming a project no remote here points at is cloned instead, and that is
 * what lets a review start from any folder.
 */
export async function openPullRequestWorkspace(
  directory: string, location: PullRequestLocation, cloneUrl?: string,
): Promise<PullRequestWorkspace> {
  const wanted = location.project;
  if (wanted === null) return workspaceForNumber(directory);
  return (await workspaceForProject(directory, wanted))
    ?? await cloneProject(wanted, cloneUrl ?? cloneUrlOf(wanted));
}

/** Mode of every file in a temporary checkout: readable by all, writable by none. */
const READ_ONLY_MODE = 0o444;

/** How many files are made read-only at once, so a large tree opens no handle storm. */
const READ_ONLY_BATCH = 128;

/**
 * Check out the request head, and let nobody write to it.
 *
 * The map reads Git objects, so the checkout is for the reader instead: "open
 * in" and an agent ask both work on files on disk. The folder goes away when
 * the run ends, so the files are read-only, and an editor refuses an edit
 * rather than losing it when the run stops.
 */
async function checkOutReadOnly(directory: string, rev: string): Promise<void> {
  await git(directory, ["checkout", "--quiet", "--detach", rev], NO_TERMINAL_PROMPT);
  const listed = await git(directory, ["ls-files", "--stage", "-z"]);
  const paths: string[] = [];
  for (const record of listed.split("\0")) {
    // `<mode> <object> <stage>\t<path>`, and only a regular file has a mode to
    // set. A symbolic link is left alone, because chmod would follow it out of
    // the folder and touch whatever it points at.
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const mode = record.slice(0, 6);
    if (mode !== "100644" && mode !== "100755") continue;
    paths.push(record.slice(tab + 1));
  }
  for (let start = 0; start < paths.length; start += READ_ONLY_BATCH) {
    await Promise.all(paths.slice(start, start + READ_ONLY_BATCH)
      .map((relativePath) => chmod(path.join(directory, relativePath), READ_ONLY_MODE)));
  }
}

/**
 * Bring in the blobs the comparison is about to read, in one fetch.
 *
 * A blobless clone holds none of them, and Git fetches what a command misses
 * as that command runs. One command that reads both sides of every changed
 * file is therefore one round trip, where measuring file by file would be one
 * per file.
 */
async function warmChangedBlobs(directory: string, base: string, target: string): Promise<void> {
  await git(directory, ["diff", "--numstat", base, target], NO_TERMINAL_PROMPT);
}

/**
 * What the forge knows about a pull request, which Git cannot be asked.
 *
 * The branch a request targets is the thing Git has no record of. A repository
 * holds the head and the base branch as commits, and nothing in it anywhere
 * says the two were ever proposed against each other.
 */
export interface PullRequestMetadata {
  number: number;
  /** Branch the request is against. Frequently not the repository default. */
  baseBranch: string;
  /** Head commit, as the forge has it. */
  headSha: string;
  /**
   * Commit that took the request into the base branch, or `null` while it is
   * open. A squash, a rebase, and a merge commit all land here.
   */
  mergeSha: string | null;
}

/** Which forge a host is. */
type Forge = "github" | "gitlab";

function forgeOf(host: string): Forge | null {
  if (host.includes("github")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  return null;
}

/** The ref a forge publishes a pull request head under. */
function headRefOf(forge: Forge, number: number): string {
  return forge === "github" ? `refs/pull/${number}/head` : `refs/merge-requests/${number}/head`;
}

async function runForgeCommand(directory: string, command: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      cwd: directory, maxBuffer: 32 * 1024 * 1024, encoding: "utf8",
    });
    return stdout;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      throw new GitError(
        `--pr needs the ${command} command, which is not on this PATH. Install it and sign in, `
        + "because only the forge knows which branch a pull request is against",
      );
    }
    throw new GitError(`${command} ${args.join(" ")} failed: ${failureDetail(cause)}`);
  }
}

/**
 * Ask the forge about a pull request.
 *
 * This is the one thing `--pr` cannot do with Git, and it is why `--pr` wants
 * `gh` or `glab` signed in. Without it the base branch has to be guessed as the
 * repository default, which is wrong for every request raised against anything
 * else, and wrong quietly: the page would draw a comparison and never say it
 * had measured a different one.
 */
async function readPullRequestMetadata(
  directory: string, project: Project, number: number,
): Promise<PullRequestMetadata> {
  const forge = forgeOf(project.host);
  if (forge === null) {
    throw new GitError(`--pr does not know the forge at ${project.host}. It knows GitHub and GitLab`);
  }
  if (forge === "github") {
    const stdout = await runForgeCommand(directory, "gh", [
      "pr", "view", String(number),
      "--repo", `${project.host}/${project.webPath}`,
      "--json", "baseRefName,headRefOid,mergeCommit",
    ]);
    const view = JSON.parse(stdout) as {
      baseRefName?: string; headRefOid?: string; mergeCommit?: { oid?: string } | null;
    };
    if (!view.baseRefName || !view.headRefOid) {
      throw new GitError(`gh did not say what pull request ${number} is against`);
    }
    return {
      number,
      baseBranch: view.baseRefName,
      headSha: view.headRefOid,
      mergeSha: view.mergeCommit?.oid ?? null,
    };
  }
  const stdout = await runForgeCommand(directory, "glab", [
    "mr", "view", String(number), "--repo", `${project.host}/${project.webPath}`, "--output", "json",
  ]);
  const view = JSON.parse(stdout) as {
    target_branch?: string; sha?: string; merge_commit_sha?: string | null; squash_commit_sha?: string | null;
  };
  if (!view.target_branch || !view.sha) {
    throw new GitError(`glab did not say what merge request ${number} is against`);
  }
  return {
    number,
    baseBranch: view.target_branch,
    headSha: view.sha,
    mergeSha: view.merge_commit_sha || view.squash_commit_sha || null,
  };
}

/**
 * The commit a pull request was written against.
 *
 * One rule for every state a request can be in: the merge base of the head and
 * the base branch as it stood the last time the request was measured against
 * it. While the request is open that is the branch tip. Once it has landed the
 * branch has moved past it, and where the merge sat is where it stood, whether
 * the forge squashed, rebased, or merged.
 *
 * Taking the branch tip after a merge would be wrong twice over: for a squash
 * or a rebase it is too far ahead, and for a merge commit the head is inside
 * the branch, so the merge base would be the head and the change would read as
 * empty.
 */
async function pullRequestBase(
  directory: string, metadata: PullRequestMetadata, baseBranch: string, head: string,
): Promise<string> {
  const stood = metadata.mergeSha === null ? baseBranch : `${metadata.mergeSha}^1`;
  const mergeBase = (await git(directory, ["merge-base", stood, head])).trim();
  if (!mergeBase) throw new GitError(`no merge base between ${stood} and ${head}`);
  return mergeBase;
}

/**
 * What to call the commit a pull request was written against.
 *
 * A ref that points exactly at it says what an object name cannot, and the base
 * branch is the one worth naming. Failing that `git describe` still places the
 * commit, as `v2.0.0-23-g6bf16a921`: the last release, how far past it the
 * branch forked, and the commit. That is a landmark and a revision at once,
 * because the trailing object name pins it, so a name on the chip can never
 * drift away from the commit it was measured at.
 */
async function nameForBase(directory: string, baseBranch: string, sha: string): Promise<string> {
  if (await isRevision(directory, baseBranch) && await commitName(directory, baseBranch) === sha) return baseBranch;
  // `--always` answers with the abbreviated commit when the repository has no
  // tag to measure from, which is the same answer as before this named anything.
  return (await git(directory, ["describe", "--tags", "--always", sha])).trim();
}

/** A fetched pull request, and the comparison that reviews it. */
export interface FetchedPullRequest {
  request: ComparisonRequest;
  remote: string;
  /** Repository holding the head, which is the root the comparison measures. */
  directory: string;
  /** Folder to remove when the run ends, or `null` when a repository here served the request. */
  temporaryClone: string | null;
  number: number;
  /** Ref on the remote the head came from. */
  remoteRef: string;
  /** Ref this repository now holds the head under. */
  localRef: string;
  /** Branch the pull request is against, as the forge names it. */
  baseBranch: string;
}

/** What a caller hands in rather than lets this module work out for itself. */
export interface FetchPullRequestOptions {
  /** The forge's answer, passed in by the tests, which have no forge to ask. */
  metadata?: PullRequestMetadata;
  /** Where a temporary clone is made from. The tests point it at a local upstream. */
  cloneUrl?: string;
}

/**
 * Fetch a pull request and build the comparison that reviews it.
 *
 * The forge says which branch the request is against and whether it has landed.
 * Git supplies the commits: the head lands in a namespace of ours, so no branch
 * a person named is touched, and it reaches a request whose own branch the
 * forge has since deleted, which is most of what reviewing a merged change
 * means.
 *
 * The repository is the one whose remote serves the project, and a temporary
 * clone when this machine holds none. A clone is checked out and made
 * read-only, because the reader gets a folder that is gone when the run ends.
 */
export async function fetchPullRequest(
  directory: string, location: PullRequestLocation, options: FetchPullRequestOptions = {},
): Promise<FetchedPullRequest> {
  const workspace = await openPullRequestWorkspace(directory, location, options.cloneUrl);
  const { remote, project, temporaryClone } = workspace;
  const repository = workspace.directory;

  const known = options.metadata ?? await readPullRequestMetadata(repository, project, location.number);
  const forge = forgeOf(project.host) ?? "github";

  const remoteRef = headRefOf(forge, location.number);
  const localRef = `refs/slopsplorer/pull/${location.number}`;
  await git(repository, ["fetch", "--no-tags", remote, `+${remoteRef}:${localRef}`], NO_TERMINAL_PROMPT);

  // The base branch, and the commit a landed request sat on, are both on the
  // remote and neither is necessarily in this repository yet.
  const baseBranch = `${remote}/${known.baseBranch}`;
  if (known.mergeSha === null && !(await isRevision(repository, baseBranch))) {
    await git(
      repository,
      ["fetch", "--no-tags", remote, `+refs/heads/${known.baseBranch}:refs/remotes/${baseBranch}`],
      NO_TERMINAL_PROMPT,
    );
  }
  if (known.mergeSha !== null && !(await isRevision(repository, known.mergeSha))) {
    await git(repository, ["fetch", "--no-tags", remote, known.mergeSha], NO_TERMINAL_PROMPT);
  }

  const base = await pullRequestBase(repository, known, baseBranch, localRef);
  if (temporaryClone !== null) {
    await checkOutReadOnly(repository, localRef);
    await warmChangedBlobs(repository, base, localRef);
  }
  return {
    request: { kind: "revisionPair", base: await nameForBase(repository, baseBranch, base), target: localRef },
    remote,
    directory: repository,
    temporaryClone,
    number: location.number,
    remoteRef,
    localRef,
    baseBranch: known.baseBranch,
  };
}

/** One entry of the changed-file list, before either side is measured. */
export interface ChangedFile {
  /** Path on the target side. A deleted file keeps the path it had. */
  path: string;
  /** Path on the base side. Differs from `path` only for a rename. */
  basePath: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

/**
 * Files Git does not track and no ignore rule covers.
 *
 * `git diff` cannot see them, but a file written a minute ago is most of what
 * uncommitted work is. A scan already counts them, so a diff against the
 * working tree that dropped them would report less change than there is.
 */
async function listUntrackedFiles(directory: string): Promise<string[]> {
  const stdout = await git(directory, ["ls-files", "-z", "--others", "--exclude-standard", "--", "."]);
  return stdout.split("\0").filter(Boolean);
}

/**
 * List what a comparison changed, with renames detected.
 *
 * `-M` is not optional. Without it one renamed file reads as a whole-file add
 * beside a whole-file delete, so moving a folder would fill the map with
 * change nobody wrote.
 */
export async function listChangedFiles(directory: string, comparison: Comparison): Promise<ChangedFile[]> {
  const stdout = await git(directory, [
    "diff", "--name-status", "-z", "-M", ...comparison.diffArguments,
  ]);
  const fields = stdout.split("\0");
  const changed: ChangedFile[] = [];
  let cursor = 0;
  while (cursor < fields.length) {
    const code = fields[cursor];
    if (code === undefined || code === "") break;
    const letter = code[0]!;
    if (letter === "R" || letter === "C") {
      const from = fields[cursor + 1];
      const to = fields[cursor + 2];
      cursor += 3;
      if (from === undefined || to === undefined) break;
      // A copy leaves its source in place, so only the new path is new content.
      changed.push(letter === "R"
        ? { path: to, basePath: from, status: "renamed" }
        : { path: to, basePath: to, status: "added" });
      continue;
    }
    const filePath = fields[cursor + 1];
    cursor += 2;
    if (filePath === undefined) break;
    if (letter === "A") changed.push({ path: filePath, basePath: filePath, status: "added" });
    else if (letter === "D") changed.push({ path: filePath, basePath: filePath, status: "deleted" });
    // A type change and an unmerged path both have two contents, which is all
    // a measurement needs, so neither earns a status of its own.
    else changed.push({ path: filePath, basePath: filePath, status: "modified" });
  }

  if (comparison.target.kind === "worktree") {
    const tracked = new Set(changed.map((entry) => entry.path));
    for (const filePath of await listUntrackedFiles(directory)) {
      if (!tracked.has(filePath)) changed.push({ path: filePath, basePath: filePath, status: "added" });
    }
  }
  return changed;
}

interface PendingRead {
  resolve: (value: Buffer | null) => void;
  reject: (cause: unknown) => void;
}

/**
 * Reads blobs out of a repository through one long-lived `git cat-file`.
 *
 * A `git show` for each file would spend seconds of process startup on a diff
 * of several hundred files. `--batch` answers in the order it is asked, so the
 * requests queue and the replies pair off against them.
 */
export class GitObjectReader {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending: PendingRead[] = [];
  readonly #chunks: Buffer[] = [];
  #buffered = 0;
  #failure: Error | null = null;

  constructor(cwd: string) {
    // `-z` makes the request side NUL-delimited, so a path holding a newline
    // still names one object rather than two.
    this.#child = spawn("git", ["cat-file", "--batch", "-z"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.#child.stdout.on("data", (chunk: Buffer) => {
      this.#chunks.push(chunk);
      this.#buffered += chunk.length;
      this.#deliver();
    });
    this.#child.on("error", (cause) => this.#abort(cause));
    this.#child.on("close", (code) => {
      if (this.#pending.length > 0) this.#abort(new GitError(`git cat-file exited with code ${code}`));
    });
  }

  /**
   * Ask for one object, such as `HEAD:src/cli.ts` or `:staged/path`.
   *
   * Resolves to `null` when the repository does not hold it, which is the
   * normal answer for the base side of an added file.
   */
  read(spec: string): Promise<Buffer | null> {
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise<Buffer | null>((resolve, reject) => {
      this.#pending.push({ resolve, reject });
      this.#child.stdin.write(`${spec}\0`);
    });
  }

  dispose(): void {
    this.#child.stdin.end();
    this.#child.kill();
  }

  #abort(cause: unknown): void {
    this.#failure = cause instanceof Error ? cause : new GitError(String(cause));
    while (this.#pending.length > 0) this.#pending.shift()!.reject(this.#failure);
  }

  #take(length: number): Buffer {
    const joined = Buffer.concat(this.#chunks);
    this.#chunks.length = 0;
    if (joined.length > length) this.#chunks.push(joined.subarray(length));
    this.#buffered = joined.length - length;
    return joined.subarray(0, length);
  }

  #deliver(): void {
    for (;;) {
      if (this.#pending.length === 0) return;
      const joined = this.#chunks.length === 1 ? this.#chunks[0]! : Buffer.concat(this.#chunks);
      if (this.#chunks.length > 1) {
        this.#chunks.length = 0;
        this.#chunks.push(joined);
      }
      const newline = joined.indexOf(0x0a);
      if (newline < 0) return;
      const header = joined.subarray(0, newline).toString("utf8");
      const size = Number(header.slice(header.lastIndexOf(" ") + 1));
      const missing = !Number.isFinite(size);
      // The payload is followed by one newline that belongs to the protocol
      // rather than to the blob.
      const total = missing ? newline + 1 : newline + 1 + size + 1;
      if (this.#buffered < total) return;
      const block = this.#take(total);
      this.#pending.shift()!.resolve(
        missing ? null : Buffer.from(block.subarray(newline + 1, newline + 1 + size)),
      );
    }
  }
}

/**
 * Byte size of each object, or `null` where the repository holds none.
 *
 * Asked before the content is, so a blob over the per-file ceiling is never
 * pulled through the pipe just to be dropped.
 */
export async function objectSizes(cwd: string, specs: readonly string[]): Promise<(number | null)[]> {
  if (specs.length === 0) return [];
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch-check", "--buffer", "-z"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new GitError(`git cat-file --batch-check exited with code ${code}`));
    });
    child.stdin.end(`${specs.join("\0")}\0`);
  });
  const lines = stdout.split("\n").filter((line) => line !== "");
  if (lines.length !== specs.length) {
    throw new GitError(`git cat-file --batch-check answered ${lines.length} of ${specs.length} objects`);
  }
  return lines.map((line) => {
    const size = Number(line.slice(line.lastIndexOf(" ") + 1));
    return Number.isFinite(size) ? size : null;
  });
}
