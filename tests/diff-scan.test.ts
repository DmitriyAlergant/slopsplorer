import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanDiff } from "../src/scanner/diffScan.ts";
import { resolveComparison } from "../src/scanner/gitdiff.ts";
import type { ScanIndex } from "../src/scanner/scan.ts";
import type { FileRow } from "../src/shared/api.ts";

const execFileAsync = promisify(execFile);
const SCAN_TIMEOUT_MS = 60_000;

let root: string;
let index: ScanIndex;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function write(relativePath: string, contents: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, "utf8");
}

async function commit(message: string): Promise<void> {
  await git("add", "-A");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-m", message);
}

const BEFORE_MAIN = `// Scheduler.
export function schedule(jobs: string[]): string[] {
  const queue: string[] = [];

  for (const job of jobs) {
    queue.push(job);
  }
  return queue;
}
`;

/**
 * The edit opens a block comment inside the added lines, which is the case a
 * per-line verdict taken out of context would get wrong.
 */
const AFTER_MAIN = `// Scheduler.
export function schedule(jobs: string[]): string[] {
  const queue: string[] = [];

  /*
   * Jobs arrive unsorted.
   */
  for (const job of jobs) {
    if (job.length > 0) {
      queue.push(job);
    }
  }
  return queue;
}
`;

const MOVED_BEFORE = `export const RETRIES = 3;
export const TIMEOUT = 1000;
export const BACKOFF = 2;
export const CEILING = 30;
export const FLOOR = 1;
`;

const MOVED_AFTER = `export const RETRIES = 5;
export const TIMEOUT = 1000;
export const BACKOFF = 2;
export const CEILING = 30;
export const FLOOR = 1;
`;

function rowFor(filePath: string): FileRow {
  const row = index.files.find((file) => file.path === filePath);
  if (row === undefined) throw new Error(`no row for ${filePath}: ${index.files.map((f) => f.path).join(", ")}`);
  return row;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-diff-"));
  await git("init", "-q", "-b", "main");

  await write("src/main.ts", BEFORE_MAIN);
  await write("src/gone.ts", "export const removed = 1;\nexport const alsoRemoved = 2;\n");
  await write("src/old/name.ts", MOVED_BEFORE);
  await commit("base");

  await write("src/main.ts", AFTER_MAIN);
  await rm(path.join(root, "src/gone.ts"));
  await rm(path.join(root, "src/old/name.ts"));
  await write("src/new/name.ts", MOVED_AFTER);
  await write("src/fresh.ts", "// Brand new.\nexport const fresh = true;\n\nexport const other = 1;\n");
  await commit("change");

  const comparison = await resolveComparison(root, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" });
  index = await scanDiff({
    root,
    comparison,
    tokenizer: "cl100k_base",
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 4,
  });
}, SCAN_TIMEOUT_MS);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("diff scan", () => {
  /**
   * The anchor, and the reason it is not a line-for-line match with `cloc`'s
   * shape: `--numstat` counts physical lines, blank ones included, while every
   * bucketed figure this scanner reports excludes them. The physical counts are
   * what the two can be held to exactly.
   */
  it("counts the same physical added and removed lines as git diff --numstat", async () => {
    // `-z` so a rename reports its two paths as separate fields rather than
    // as the `old => new` shorthand, which is display syntax and not a path.
    const numstat = await git("diff", "--numstat", "-z", "-M", "HEAD~1", "HEAD");
    const fields = numstat.split("\0");
    const expected = new Map<string, { added: number; removed: number }>();
    let cursor = 0;
    while (cursor < fields.length && fields[cursor] !== "" && fields[cursor] !== undefined) {
      const [added, removed, inlinePath] = fields[cursor]!.split("\t");
      if (inlinePath === "") {
        expected.set(fields[cursor + 2]!, { added: Number(added), removed: Number(removed) });
        cursor += 3;
        continue;
      }
      expected.set(inlinePath!, { added: Number(added), removed: Number(removed) });
      cursor += 1;
    }

    for (const file of index.files) {
      expect({ path: file.path, added: file.addedPhysicalLines, removed: file.removedPhysicalLines })
        .toEqual({ path: file.path, ...expected.get(file.path)! });
    }
    expect(index.files.length).toBe(expected.size);
  });

  it("splits every measure into two identities that hold for each file", () => {
    for (const file of index.files) {
      expect(file.churnTokens).toBe(file.addedTokens + file.removedTokens);
      expect(file.netTokens).toBe(file.addedTokens - file.removedTokens);
      expect(file.churnLines).toBe(file.addedLines + file.removedLines);
      expect(file.netLines).toBe(file.addedLines - file.removedLines);
      expect(file.churnCodeLines).toBe(file.addedCodeLines + file.removedCodeLines);
      expect(file.netCodeLines).toBe(file.addedCodeLines - file.removedCodeLines);
    }
  });

  it("keeps every bucketed count inside its physical count, because blank lines fall out", () => {
    for (const file of index.files) {
      expect(file.addedLines).toBe(file.addedCodeLines + file.addedCommentLines);
      expect(file.removedLines).toBe(file.removedCodeLines + file.removedCommentLines);
      expect(file.addedLines).toBeLessThanOrEqual(file.addedPhysicalLines);
      expect(file.removedLines).toBeLessThanOrEqual(file.removedPhysicalLines);
    }
  });

  it("classifies an added line by the comment state of the side it came from", () => {
    const main = rowFor("src/main.ts");
    // The opener, the body, and the closer are all commentary even though only
    // the middle line looks like one on its own. The guard, its statement, and
    // its brace are the added code, and the re-indented statement they replace
    // is the one line removed.
    expect(main.addedCommentLines).toBe(3);
    expect(main.addedCodeLines).toBe(3);
    expect(main.removedCommentLines).toBe(0);
    expect(main.removedCodeLines).toBe(1);
    expect(main.status).toBe("modified");
  });

  it("reports a deleted file as removal only, and an added file as addition only", () => {
    const gone = rowFor("src/gone.ts");
    expect(gone.status).toBe("deleted");
    expect(gone.addedLines).toBe(0);
    expect(gone.removedLines).toBe(2);
    expect(gone.lines).toBe(0);
    expect(gone.netLines).toBe(-2);

    const fresh = rowFor("src/fresh.ts");
    expect(fresh.status).toBe("added");
    expect(fresh.removedLines).toBe(0);
    expect(fresh.addedCodeLines).toBe(2);
    expect(fresh.addedCommentLines).toBe(1);
  });

  it("follows a rename instead of reading it as a whole file added beside one deleted", () => {
    const moved = rowFor("src/new/name.ts");
    expect(moved.status).toBe("renamed");
    expect(moved.previousPath).toBe("src/old/name.ts");
    expect(moved.churnLines).toBe(2);
    expect(moved.netLines).toBe(0);
    expect(index.files.some((file) => file.path === "src/old/name.ts")).toBe(false);
  });

  it("keeps the after-image structure counts beside the before-image ones", () => {
    const main = rowFor("src/main.ts");
    expect(main.branches).toBeGreaterThan(main.beforeBranches);
    expect(rowFor("src/gone.ts").functions).toBe(0);
  });

  it("describes the comparison in the meta, so the page can name what it drew", () => {
    expect(index.meta.fileSource).toBe("git-diff");
    expect(index.meta.diff).toMatchObject({
      base: "HEAD~1", target: "HEAD", filesAdded: 1, filesModified: 1, filesDeleted: 1, filesRenamed: 1,
    });
  });

  it("skips a file whose either side is over the ceiling, and counts it", async () => {
    const comparison = await resolveComparison(root, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" });
    const tiny = await scanDiff({
      root, comparison, tokenizer: "cl100k_base", exclude: [], maxFileBytes: 40, concurrency: 4,
    });
    expect(tiny.meta.skippedLargeFiles).toBeGreaterThan(0);
    expect(tiny.files.length).toBeLessThan(index.files.length);
  }, SCAN_TIMEOUT_MS);

  it("sorts files by path, so a subtree stays one slice of the index", () => {
    expect(index.files.map((file) => file.path)).toEqual([...index.files.map((file) => file.path)].sort());
  });

  it("uses only the target revision to decide which export roots exist", async () => {
    const revisionRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-export-diff-"));
    const revisionGit = async (...args: string[]): Promise<void> => {
      await execFileAsync("git", args, { cwd: revisionRoot, maxBuffer: 64 * 1024 * 1024 });
    };
    const revisionWrite = async (relativePath: string, contents: string): Promise<void> => {
      const absolute = path.join(revisionRoot, relativePath);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, contents, "utf8");
    };
    const revisionCommit = async (message: string): Promise<void> => {
      await revisionGit("add", "-A");
      await revisionGit(
        "-c", "user.name=Test", "-c", "user.email=test@example.com",
        "commit", "--no-gpg-sign", "-m", message,
      );
    };

    try {
      await revisionGit("init", "-q", "-b", "main");
      await revisionWrite("src/main.ts", "export const main = true;\n");
      await revisionWrite("site/.slopsplorer-export", "");
      await revisionWrite("site/assets/app.js", "export const generated = 1;\n");
      await revisionCommit("base");
      await revisionWrite("site/assets/app.js", "export const generated = 2;\n");
      await revisionCommit("change generated bundle");

      const comparison = await resolveComparison(
        revisionRoot,
        { kind: "revisionPair", base: "HEAD~1", target: "HEAD" },
      );
      const revisionIndex = await scanDiff({
        root: revisionRoot,
        comparison,
        tokenizer: "cl100k_base",
        exclude: [],
        maxFileBytes: 2 * 1024 * 1024,
        concurrency: 2,
      });

      expect(revisionIndex.files).toEqual([]);

      await rm(path.join(revisionRoot, "site/.slopsplorer-export"));
      await revisionWrite(".slopsplorer-export", "");
      await revisionCommit("move export marker to root");
      await rm(path.join(revisionRoot, ".slopsplorer-export"));
      await revisionWrite("src/main.ts", "export const main = false;\n");
      await revisionCommit("remove export marker");

      const markerRemoval = await resolveComparison(
        revisionRoot,
        { kind: "revisionPair", base: "HEAD~1", target: "HEAD" },
      );
      const visibleIndex = await scanDiff({
        root: revisionRoot,
        comparison: markerRemoval,
        tokenizer: "cl100k_base",
        exclude: [],
        maxFileBytes: 2 * 1024 * 1024,
        concurrency: 2,
      });
      expect(visibleIndex.files.map((file) => file.path)).toEqual(["src/main.ts"]);
    } finally {
      await rm(revisionRoot, { recursive: true, force: true });
    }
  }, SCAN_TIMEOUT_MS);
});
