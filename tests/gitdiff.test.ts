import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitError, parseComparisonSpec, resolveComparison } from "../src/scanner/gitdiff.ts";

const execFileAsync = promisify(execFile);

let root: string;
let baseSha: string;
let headSha: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout;
}

async function commit(fileName: string, contents: string, message: string): Promise<string> {
  await writeFile(path.join(root, fileName), contents, "utf8");
  await git("add", "-A");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-m", message);
  return (await git("rev-parse", "HEAD")).trim();
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-gitdiff-"));
  await git("init", "-q", "-b", "main");
  baseSha = await commit("a.ts", "export const a = 1;\n", "base");
  headSha = await commit("a.ts", "export const a = 2;\n", "change");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveComparison", () => {
  it("resolves two different revisions", async () => {
    const comparison = await resolveComparison(root, { kind: "revisionPair", base: baseSha, target: headSha });
    expect(comparison.diffArguments).toEqual([baseSha, headSha]);
  });

  /**
   * A comparison of a commit with itself can only ever draw an empty page, so
   * it is refused where the sides become concrete rather than measured and
   * served as nothing.
   */
  it("refuses a pair naming one commit twice", async () => {
    await expect(resolveComparison(root, { kind: "revisionPair", base: headSha, target: headSha }))
      .rejects.toThrow(GitError);
  });

  it("refuses a pair whose two names resolve to one commit", async () => {
    await expect(resolveComparison(root, { kind: "revisionPair", base: "HEAD", target: headSha }))
      .rejects.toThrow(/same commit/);
  });

  it("refuses a merge-base comparison whose target is already an ancestor of the base", async () => {
    await expect(resolveComparison(root, { kind: "mergeBase", base: "HEAD", target: baseSha }))
      .rejects.toThrow(/ancestor/);
  });

  it("allows a revision against the working tree, which the revision alone cannot settle", async () => {
    const comparison = await resolveComparison(root, { kind: "revisionToWorkingTree", rev: "HEAD" });
    expect(comparison.target).toEqual({ kind: "worktree" });
  });
});

/**
 * One positional slot carries two intents, and the text is what tells them
 * apart. A name is a place to measure from; a raw object name is one commit
 * somebody pasted.
 */
describe("what a single revision argument asks for", () => {
  it("reads a raw object name as that commit against its parent", () => {
    expect(parseComparisonSpec(["f53f4f9eb"]))
      .toEqual({ kind: "revisionPair", base: "f53f4f9eb^", target: "f53f4f9eb" });
    expect(parseComparisonSpec(["34e5f5d369e5eb60d3644c92ed67f6c5f6734d68"]))
      .toEqual({
        kind: "revisionPair",
        base: "34e5f5d369e5eb60d3644c92ed67f6c5f6734d68^",
        target: "34e5f5d369e5eb60d3644c92ed67f6c5f6734d68",
      });
  });

  it("still reads a named revision as a place to measure from", () => {
    expect(parseComparisonSpec(["origin/main"])).toEqual({ kind: "revisionToWorkingTree", rev: "origin/main" });
    expect(parseComparisonSpec(["HEAD~5"])).toEqual({ kind: "revisionToWorkingTree", rev: "HEAD~5" });
    expect(parseComparisonSpec(["v1.4"])).toEqual({ kind: "revisionToWorkingTree", rev: "v1.4" });
    expect(parseComparisonSpec(["HEAD"])).toEqual({ kind: "revisionToWorkingTree", rev: "HEAD" });
  });

  it("takes Git's own notation for one commit, whatever names it", () => {
    expect(parseComparisonSpec(["origin/main^!"]))
      .toEqual({ kind: "revisionPair", base: "origin/main^", target: "origin/main" });
    expect(parseComparisonSpec(["HEAD^!"])).toEqual({ kind: "revisionPair", base: "HEAD^", target: "HEAD" });
  });

  it("leaves the range operators alone", () => {
    expect(parseComparisonSpec(["main...HEAD"])).toEqual({ kind: "mergeBase", base: "main", target: "HEAD" });
    expect(parseComparisonSpec(["main..HEAD"])).toEqual({ kind: "revisionPair", base: "main", target: "HEAD" });
  });
});

describe("a pasted commit, end to end", () => {
  it("compares it against its predecessor", async () => {
    const comparison = await resolveComparison(root, parseComparisonSpec([headSha]));
    expect(comparison.diffArguments).toEqual([`${headSha}^`, headSha]);
  });
});
