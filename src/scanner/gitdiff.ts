import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Where one side of a comparison reads its content from. */
export type DiffSide =
  | { kind: "revision"; rev: string }
  | { kind: "index" }
  | { kind: "worktree" };

/** What the command line asked to compare, resolved against a repository. */
export interface Comparison {
  /** The comparison as it was named on the command line. */
  spec: string;
  base: DiffSide;
  target: DiffSide;
  baseLabel: string;
  targetLabel: string;
  /** Arguments that select this comparison for `git diff`. */
  diffArguments: string[];
}

/** How a comparison was requested, before it is resolved against a repository. */
export type RevisionRange =
  | { kind: "revisionPair"; base: string; target: string }
  | { kind: "mergeBase"; base: string; target: string };

export type ComparisonRequest =
  | { kind: "workingTree" }
  | { kind: "staged" }
  | { kind: "revisionToWorkingTree"; rev: string }
  | RevisionRange;

export class GitError extends Error {}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8",
    });
    return stdout;
  } catch (cause) {
    const detail = cause instanceof Error && "stderr" in cause ? String(cause.stderr).trim() : String(cause);
    throw new GitError(`git ${args.join(" ")} failed: ${detail || "unknown error"}`);
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
 * Split a revision argument on its range operator.
 *
 * `A...B` compares B against the merge base, which is what a pull request
 * shows, and `A..B` compares A to B directly, matching `git diff A B`.
 */
export function parseRevisionArgument(argument: string): RevisionRange | null {
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

async function shortName(directory: string, rev: string): Promise<string> {
  return (await git(directory, ["rev-parse", "--short", rev])).trim();
}

/** Resolve a requested comparison into concrete sides and `git diff` arguments. */
export async function resolveComparison(directory: string, request: ComparisonRequest): Promise<Comparison> {
  switch (request.kind) {
    case "workingTree":
      return {
        spec: "--diff",
        base: { kind: "revision", rev: "HEAD" },
        target: { kind: "worktree" },
        baseLabel: "HEAD",
        targetLabel: "working tree",
        diffArguments: ["HEAD"],
      };
    case "staged":
      return {
        spec: "--staged",
        base: { kind: "revision", rev: "HEAD" },
        target: { kind: "index" },
        baseLabel: "HEAD",
        targetLabel: "index",
        diffArguments: ["--cached", "HEAD"],
      };
    case "revisionToWorkingTree":
      return {
        spec: request.rev,
        base: { kind: "revision", rev: request.rev },
        target: { kind: "worktree" },
        baseLabel: request.rev,
        targetLabel: "working tree",
        diffArguments: [request.rev],
      };
    case "revisionPair":
      return {
        spec: `${request.base}..${request.target}`,
        base: { kind: "revision", rev: request.base },
        target: { kind: "revision", rev: request.target },
        baseLabel: request.base,
        targetLabel: request.target,
        diffArguments: [request.base, request.target],
      };
    case "mergeBase": {
      const mergeBase = (await git(directory, ["merge-base", request.base, request.target])).trim();
      if (!mergeBase) throw new GitError(`no merge base between ${request.base} and ${request.target}`);
      return {
        spec: `${request.base}...${request.target}`,
        base: { kind: "revision", rev: mergeBase },
        target: { kind: "revision", rev: request.target },
        baseLabel: `${await shortName(directory, mergeBase)} (merge base with ${request.base})`,
        targetLabel: request.target,
        diffArguments: [`${request.base}...${request.target}`],
      };
    }
  }
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
