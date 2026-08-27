import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveComparison } from "../src/scanner/gitdiff.ts";
import { buildSpine } from "../src/scanner/spine.ts";
import type { CommitSpine } from "../src/shared/api.ts";

const execFileAsync = promisify(execFile);
const SETUP_TIMEOUT_MS = 60_000;

let root: string;
let spine: CommitSpine;
let baseSha: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout;
}

async function commit(files: Record<string, string>, message: string): Promise<string> {
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(root, name), contents, "utf8");
  }
  await git("add", "-A");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-m", message);
  return (await git("rev-parse", "HEAD")).trim();
}

function lines(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `export const ${prefix}${index} = ${index};`).join("\n") + "\n";
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-spine-"));
  await git("init", "-q", "-b", "main");

  baseSha = await commit({ "a.ts": lines(3, "a") }, "base");
  await commit(
    { "b.ts": lines(10, "b") },
    "add ten\n\nThe queue was unbounded, so a slow consumer grew it without limit.\nTen entries is the ceiling.",
  );
  await commit({ "a.ts": lines(1, "a") }, "cut a down");
  // Nobody wrote this one, and it dwarfs every commit around it.
  await commit({ "package-lock.json": lines(400, "locked") }, "regenerate the lockfile");

  const comparison = await resolveComparison(root, { kind: "revisionPair", base: baseSha, target: "HEAD" });
  const built = await buildSpine({
    root,
    comparison,
    tokenizer: "cl100k_base",
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 4,
  }, { kind: "revisionPair", base: baseSha, target: "HEAD" });
  if (built === null) throw new Error("a comparison of two revisions has a spine");
  spine = built;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("buildSpine", () => {
  it("lists the range's commits oldest first", () => {
    expect(spine.commits.map((entry) => entry.subject))
      .toEqual(["add ten", "cut a down", "regenerate the lockfile"]);
    expect(spine.omitted).toBe(0);
  });

  it("starts the range from the parent of the first commit", () => {
    expect(spine.base).toBe(baseSha);
  });

  it("carries the message under the subject, so a tooltip can explain a commit", () => {
    const added = spine.commits[0]!;
    expect(added.subject).toBe("add ten");
    expect(added.body).toBe(
      "The queue was unbounded, so a slow consumer grew it without limit.\nTen entries is the ceiling.",
    );
    // A commit with no body says nothing rather than repeating its subject.
    expect(spine.commits[1]!.body).toBe("");
  });

  it("measures each commit against its own parent", () => {
    const added = spine.commits[0]!;
    expect(added.addedLines).toBe(10);
    expect(added.removedLines).toBe(0);
    expect(added.files).toBe(1);

    const cut = spine.commits[1]!;
    expect(cut.addedLines).toBe(0);
    expect(cut.removedLines).toBe(2);
  });

  /** The one exclusion the band makes, and the reason it is worth making. */
  it("leaves generated files out, so a lockfile cannot flatten the band", () => {
    const lockfile = spine.commits[2]!;
    expect(lockfile.files).toBe(0);
    expect(lockfile.addedLines).toBe(0);
    expect(lockfile.removedLines).toBe(0);
  });

  it("carries every measure, so the band can speak the page's unit", () => {
    const added = spine.commits[0]!;
    expect(added.addedTokens).toBeGreaterThan(0);
    expect(added.addedCodeLines).toBe(10);
  });

  it("has no spine when a side is not a commit", async () => {
    const comparison = await resolveComparison(root, { kind: "workingTree" });
    const built = await buildSpine({
      root, comparison, tokenizer: "cl100k_base", exclude: [], maxFileBytes: 2 * 1024 * 1024, concurrency: 4,
    }, { kind: "workingTree" });
    expect(built).toBeNull();
  });
});
