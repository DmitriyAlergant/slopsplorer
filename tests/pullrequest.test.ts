import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitUrlBase, fetchPullRequest, parsePullRequestUrl, pullRequestBacklink, resolveComparison,
  type FetchedPullRequest, type PullRequestMetadata,
} from "../src/scanner/gitdiff.ts";
import type { ComparisonRequest } from "../src/shared/api.ts";

const execFileAsync = promisify(execFile);
const SETUP_TIMEOUT_MS = 60_000;

let workspace: string;
let upstream: string;
let rootSha: string;
let openHeadSha: string;
let beforeMergeSha: string;
let squashCommitSha: string;
let mergeCommitSha: string;
let sideBranchBaseSha: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

/** As the page and the terminal print a commit: short, and still unambiguous. */
async function shortSha(cwd: string, rev: string): Promise<string> {
  return (await git(cwd, "rev-parse", "--short", rev)).trim();
}

async function commit(cwd: string, fileName: string, contents: string, message: string): Promise<string> {
  await writeFile(path.join(cwd, fileName), contents, "utf8");
  await git(cwd, "add", "-A");
  await git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-m", message);
  return (await git(cwd, "rev-parse", "HEAD")).trim();
}

/** The URL the upstream answers to, so `projectOf` sees a forge. */
const UPSTREAM_URL = "https://github.com/test-owner/test-repo.git";

/**
 * A clone of the upstream, as a reviewer's machine holds it.
 *
 * `insteadOf` lets the remote carry a forge URL while Git talks to the folder
 * next door, so a test drives the same path a real remote does.
 */
async function clone(name: string): Promise<string> {
  const target = path.join(workspace, name);
  await execFileAsync("git", ["clone", "-q", upstream, target]);
  await git(target, "config", `url.${upstream}.insteadOf`, UPSTREAM_URL);
  await git(target, "remote", "set-url", "origin", UPSTREAM_URL);
  return target;
}

/**
 * An upstream holding three pull requests, one in each state a forge leaves
 * behind: open, squash-merged, and merged with a merge commit. Each keeps its
 * `refs/pull/<n>/head`, which is the only trace a deleted branch leaves.
 */
beforeAll(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-pr-"));
  upstream = path.join(workspace, "upstream");
  await execFileAsync("git", ["init", "-q", "-b", "main", upstream]);

  rootSha = await commit(upstream, "a.ts", "export const a = 1;\n", "root");

  // Pull request 1, still open.
  await git(upstream, "checkout", "-q", "-b", "open-work");
  openHeadSha = await commit(upstream, "open.ts", "export const open = 1;\n", "open work");
  await git(upstream, "update-ref", "refs/pull/1/head", openHeadSha);

  // Pull request 2, squash-merged: main gains one commit that is not its head.
  await git(upstream, "checkout", "-q", "main");
  await git(upstream, "checkout", "-q", "-b", "squashed");
  const squashedHead = await commit(upstream, "squashed.ts", "export const squashed = 1;\n", "squashed work");
  await git(upstream, "update-ref", "refs/pull/2/head", squashedHead);
  await git(upstream, "checkout", "-q", "main");
  squashCommitSha = await commit(upstream, "squashed.ts", "export const squashed = 1;\n", "Squashed work (#2)");
  await git(upstream, "branch", "-q", "-D", "squashed");

  // Pull request 3, merged with a merge commit: main contains its head.
  await git(upstream, "checkout", "-q", "-b", "merged");
  const mergedHead = await commit(upstream, "merged.ts", "export const merged = 1;\n", "merged work");
  await git(upstream, "update-ref", "refs/pull/3/head", mergedHead);
  await git(upstream, "checkout", "-q", "main");
  beforeMergeSha = (await git(upstream, "rev-parse", "HEAD")).trim();
  await git(
    upstream, "-c", "user.name=Test", "-c", "user.email=test@example.com",
    "merge", "--no-ff", "--no-gpg-sign", "-m", "Merge pull request #3", "merged",
  );
  mergeCommitSha = (await git(upstream, "rev-parse", "HEAD")).trim();
  await git(upstream, "branch", "-q", "-D", "merged");
  await git(upstream, "branch", "-q", "-D", "open-work");

  // Pull request 4, open against a branch that is not the repository default.
  // This is the shape that reads wrong when the base is guessed as the default.
  await git(upstream, "checkout", "-q", "-b", "release-line");
  sideBranchBaseSha = await commit(upstream, "release.ts", "export const release = 1;\n", "release line work");
  await git(upstream, "checkout", "-q", "-b", "against-release");
  const sideHead = await commit(upstream, "side.ts", "export const side = 1;\n", "work on the release line");
  await git(upstream, "update-ref", "refs/pull/4/head", sideHead);
  await git(upstream, "checkout", "-q", "main");
  await git(upstream, "branch", "-q", "-D", "against-release");
  // Main moves on, so a base guessed as the default would be plainly wrong.
  await commit(upstream, "later.ts", "export const later = 1;\n", "later work on main");
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("parsePullRequestUrl", () => {
  /** Folded for matching a remote, kept as written for a link that is followed. */
  it("reads a GitHub pull request", () => {
    expect(parsePullRequestUrl("https://github.com/SecondStack-AI/SecondStack/pull/619")).toEqual({
      number: 619,
      project: {
        host: "github.com",
        path: "secondstack-ai/secondstack",
        webPath: "SecondStack-AI/SecondStack",
      },
    });
  });

  it("reads a GitHub pull request with a tab on the end", () => {
    expect(parsePullRequestUrl("https://github.com/owner/repo/pull/12/commits")?.number).toBe(12);
  });

  it("retains a GitHub pull request page as a snapshot backlink", () => {
    expect(pullRequestBacklink("https://github.com/owner/repo/pull/12")).toEqual({
      label: "PR #12",
      url: "https://github.com/owner/repo/pull/12",
    });
  });

  it("does not reparse a validated backlink with the URL constructor", () => {
    expect(pullRequestBacklink("https://github.com:99999/owner/repo/pull/12")).toEqual({
      label: "PR #12",
      url: "https://github.com:99999/owner/repo/pull/12",
    });
  });

  it("takes the backlink label from the terminal review route", () => {
    expect(pullRequestBacklink("https://github.com/acme/merge_requests/pull/12")).toEqual({
      label: "PR #12",
      url: "https://github.com/acme/merge_requests/pull/12",
    });
  });

  it("reads a GitLab merge request under a nested group", () => {
    expect(parsePullRequestUrl("https://gitlab.example.com/group/sub/project/-/merge_requests/42")).toEqual({
      number: 42,
      project: { host: "gitlab.example.com", path: "group/sub/project", webPath: "group/sub/project" },
    });
  });

  it("retains a GitLab merge request page as a snapshot backlink", () => {
    expect(pullRequestBacklink("https://gitlab.example.com/group/sub/project/-/merge_requests/42")).toEqual({
      label: "MR !42",
      url: "https://gitlab.example.com/group/sub/project/-/merge_requests/42",
    });
  });

  it("is not a revision range or a directory", () => {
    expect(parsePullRequestUrl("main...HEAD")).toBeNull();
    expect(parsePullRequestUrl("../other-project")).toBeNull();
    expect(pullRequestBacklink("main...HEAD")).toBeNull();
  });
});

/**
 * The forge is asked for the one fact Git does not hold: which branch the
 * request is against. Here that answer is handed in, so the tests measure the
 * Git half without a network or a signed-in CLI.
 */
function metadataFor(
  number: number, baseBranch: string, headSha: string, mergeSha: string | null = null,
): PullRequestMetadata {
  return { number, baseBranch, headSha, mergeSha };
}

async function changedFilesOf(reviewer: string, fetched: { request: ComparisonRequest }): Promise<string[]> {
  const comparison = await resolveComparison(reviewer, fetched.request);
  const changed = await git(reviewer, "diff", "--name-only", ...comparison.diffArguments);
  return changed.split("\n").filter(Boolean).sort();
}

describe("fetchPullRequest", () => {
  it("fetches an open pull request and compares it against its fork point", async () => {
    const reviewer = await clone("open-clone");
    const fetched = await fetchPullRequest(
      reviewer, { number: 1, project: null }, { metadata: metadataFor(1, "main", openHeadSha) },
    );

    expect(fetched.remote).toBe("origin");
    expect(fetched.remoteRef).toBe("refs/pull/1/head");
    expect(fetched.localRef).toBe("refs/slopsplorer/pull/1");
    expect(fetched.baseBranch).toBe("main");
    expect(await changedFilesOf(reviewer, fetched)).toEqual(["open.ts"]);

    // The head is now in this repository, which is the whole point of fetching.
    expect((await git(reviewer, "rev-parse", "refs/slopsplorer/pull/1")).trim()).toBe(openHeadSha);
  }, SETUP_TIMEOUT_MS);

  /** The case that sent us here: the branch is gone and no local commit holds the change. */
  it("reaches a squash-merged pull request whose branch was deleted", async () => {
    const reviewer = await clone("squashed-clone");
    const fetched = await fetchPullRequest(
      reviewer, { number: 2, project: null }, { metadata: metadataFor(2, "main", "", squashCommitSha) },
    );
    expect(await changedFilesOf(reviewer, fetched)).toEqual(["squashed.ts"]);
  }, SETUP_TIMEOUT_MS);

  /**
   * A merge commit puts the head into the base branch, so the branch tip is no
   * use: its merge base with the head is the head, and the change reads empty.
   */
  it("reaches a pull request merged with a merge commit", async () => {
    const reviewer = await clone("merged-clone");
    const fetched = await fetchPullRequest(
      reviewer, { number: 3, project: null }, { metadata: metadataFor(3, "main", "", mergeCommitSha) },
    );

    expect(fetched.request).toMatchObject({ base: await shortSha(reviewer, beforeMergeSha) });
    expect(await changedFilesOf(reviewer, fetched)).toEqual(["merged.ts"]);
  }, SETUP_TIMEOUT_MS);

  /**
   * The bug this guards. A request raised against a release line is measured
   * against that line, not against the repository default, so it reports the
   * work in the request and not everything the two branches happen to differ by.
   */
  it("measures a pull request against the branch it is actually against", async () => {
    const reviewer = await clone("side-branch-clone");
    const fetched = await fetchPullRequest(
      reviewer, { number: 4, project: null }, { metadata: metadataFor(4, "release-line", "") },
    );

    expect(fetched.baseBranch).toBe("release-line");
    expect(fetched.request).toMatchObject({ base: "origin/release-line" });
    expect(await changedFilesOf(reviewer, fetched)).toEqual(["side.ts"]);

    // Guessed as the default branch it would have claimed the release line's
    // own work, and everything main gained since, as part of the request.
    const guessed = await resolveComparison(reviewer, {
      kind: "revisionPair", base: "origin/main", target: "refs/slopsplorer/pull/4",
    });
    const wrong = await git(reviewer, "diff", "--name-only", ...guessed.diffArguments);
    expect(wrong.split("\n").filter(Boolean).sort()).toEqual(["later.ts", "release.ts", "side.ts"]);
  }, SETUP_TIMEOUT_MS);

  it("names the base by its branch when the branch points at it", async () => {
    const reviewer = await clone("named-base-clone");
    const fetched = await fetchPullRequest(
      reviewer, { number: 4, project: null }, { metadata: metadataFor(4, "release-line", "") },
    );
    expect(fetched.request).toMatchObject({ base: "origin/release-line" });
    expect(await git(reviewer, "rev-parse", "origin/release-line")).toContain(sideBranchBaseSha);
  }, SETUP_TIMEOUT_MS);

  it("places the base with a tag when no branch points at it", async () => {
    const reviewer = await clone("described-base-clone");
    await git(reviewer, "tag", "v1.0", rootSha);
    const fetched = await fetchPullRequest(
      reviewer, { number: 1, project: null }, { metadata: metadataFor(1, "main", openHeadSha) },
    );
    expect(fetched.request).toMatchObject({ base: "v1.0" });
  }, SETUP_TIMEOUT_MS);

  it("prefers a remote of this repository over a clone", async () => {
    const reviewer = await clone("serving-clone");
    const served = { host: "github.com", path: "test-owner/test-repo", webPath: "test-owner/test-repo" };
    const fetched = await fetchPullRequest(
      reviewer, { number: 1, project: served }, { metadata: metadataFor(1, "main", openHeadSha) },
    );

    expect(fetched.temporaryClone).toBeNull();
    expect(fetched.directory).toBe(await realpath(reviewer));
  }, SETUP_TIMEOUT_MS);
});

/**
 * The review that starts anywhere. No repository here serves the project, so
 * the project is cloned to a folder of its own, and everything downstream
 * measures that clone instead of whatever the reviewer was standing in.
 */
describe("a pull request no repository here serves", () => {
  const elsewhere = { host: "github.com", path: "other/repo", webPath: "other/repo" };
  const temporaryClones: string[] = [];

  /** `cloneUrl` stands in for the forge, as `metadata` stands in for its API. */
  async function fetchFrom(directory: string): Promise<FetchedPullRequest> {
    const fetched = await fetchPullRequest(directory, { number: 1, project: elsewhere }, {
      metadata: metadataFor(1, "main", openHeadSha),
      cloneUrl: upstream,
    });
    if (fetched.temporaryClone !== null) temporaryClones.push(fetched.temporaryClone);
    return fetched;
  }

  async function folderOutsideAnyRepository(name: string): Promise<string> {
    const directory = path.join(workspace, name);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  afterAll(async () => {
    for (const directory of temporaryClones) await rm(directory, { recursive: true, force: true });
  });

  it("clones the project, and measures the request there rather than here", async () => {
    const reviewer = await clone("elsewhere-clone");
    const fetched = await fetchFrom(reviewer);

    expect(fetched.temporaryClone).not.toBeNull();
    expect(path.dirname(fetched.directory)).toBe(fetched.temporaryClone);
    // The page names the root after its folder, so the folder carries the project name.
    expect(path.basename(fetched.directory)).toBe("repo");
    expect(await changedFilesOf(fetched.directory, fetched)).toEqual(["open.ts"]);

    // The repository the reviewer was standing in holds none of it.
    await expect(git(reviewer, "rev-parse", "--verify", "refs/slopsplorer/pull/1")).rejects.toThrow();
  }, SETUP_TIMEOUT_MS);

  it("starts from a folder that is no repository at all", async () => {
    const fetched = await fetchFrom(await folderOutsideAnyRepository("not-a-repository"));
    expect(await changedFilesOf(fetched.directory, fetched)).toEqual(["open.ts"]);
  }, SETUP_TIMEOUT_MS);

  /**
   * The clone is gone when the run ends, so an edit made in it would be lost.
   * Read-only files turn that into an editor saying no.
   */
  it("checks the head out, and lets nobody write to it", async () => {
    const fetched = await fetchFrom(await folderOutsideAnyRepository("read-only-checkout"));
    const checkedOut = path.join(fetched.directory, "open.ts");

    expect(await readFile(checkedOut, "utf8")).toBe("export const open = 1;\n");
    expect((await stat(checkedOut)).mode & 0o222).toBe(0);
  }, SETUP_TIMEOUT_MS);

  /**
   * The clone exists before the fetch that reads the request, so the removal is
   * armed first. A fetch that fails, or a Ctrl-C during one, would otherwise
   * leave a folder in the temporary directory that nobody knows to remove.
   */
  it("arms the removal of the clone before anything that can fail", async () => {
    const outside = await folderOutsideAnyRepository("failing-fetch");
    const armed = process.listenerCount("exit");

    // Request 99 was never pushed to the upstream, so the head ref cannot be fetched.
    await expect(fetchPullRequest(outside, { number: 99, project: elsewhere }, {
      metadata: metadataFor(99, "main", openHeadSha),
      cloneUrl: upstream,
    })).rejects.toThrow();

    expect(process.listenerCount("exit")).toBe(armed + 1);
  }, SETUP_TIMEOUT_MS);

  it("refuses a bare number outside a repository, and says what to name instead", async () => {
    const outside = await folderOutsideAnyRepository("bare-number-outside");
    await expect(fetchPullRequest(outside, { number: 1, project: null }))
      .rejects.toThrow(/Name the pull request by the URL of its page/);
  }, SETUP_TIMEOUT_MS);
});

/**
 * A link is followed rather than compared, so the project keeps the case it was
 * written with. Which path shape a forge uses is read from the host, because a
 * remote publishes no way to ask and a wrong link only fails to open.
 */
describe("commitUrlBase", () => {
  async function baseFor(name: string, remoteUrl: string): Promise<string | null> {
    const repository = path.join(workspace, name);
    await execFileAsync("git", ["init", "-q", "-b", "main", repository]);
    await git(repository, "remote", "add", "origin", remoteUrl);
    return commitUrlBase(repository);
  }

  it("builds a GitHub commit link, keeping the project as written", async () => {
    expect(await baseFor("gh-url", "git@github.com:SecondStack-AI/SecondStack.git"))
      .toBe("https://github.com/SecondStack-AI/SecondStack/commit/");
  });

  it("builds a GitLab commit link, which sits under its own segment", async () => {
    expect(await baseFor("gl-url", "https://gitlab.example.com/group/sub/project.git"))
      .toBe("https://gitlab.example.com/group/sub/project/-/commit/");
  });

  it("offers no link when the remote is not a web forge", async () => {
    expect(await baseFor("local-url", path.join(workspace, "upstream"))).toBeNull();
  });

  it("offers no link when there is no remote at all", async () => {
    const repository = path.join(workspace, "no-remote");
    await execFileAsync("git", ["init", "-q", "-b", "main", repository]);
    expect(await commitUrlBase(repository)).toBeNull();
  });
});
