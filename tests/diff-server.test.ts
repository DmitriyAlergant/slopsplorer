import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanDiff, type DiffScanOptions } from "../src/scanner/diffScan.ts";
import { resolveComparison } from "../src/scanner/gitdiff.ts";
import { createSlopsplorerServer, type SlopsplorerServer } from "../src/server/server.ts";
import type {
  CommitSpine, ComparisonRequest, RepositoryRefs, ScanMeta, SourceResponse, ViewResponse,
} from "../src/shared/api.ts";

const execFileAsync = promisify(execFile);
const SCAN_TIMEOUT_MS = 60_000;

let root: string;
let server: SlopsplorerServer;
let serverUrl: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
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

/** Ask the page's own route to compare something else. */
async function postCompare(comparison: unknown): Promise<Response> {
  return fetch(`${serverUrl}/api/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // An unstated kind is an unwanted kind, so the view names them all.
    body: JSON.stringify({ comparison, view: { kinds: ["code", "test", "text", "i18n", "data", "other"] } }),
  });
}

async function activeMeta(): Promise<ScanMeta> {
  const response = await fetch(`${serverUrl}/api/health`);
  return ((await response.json()) as { meta: ScanMeta }).meta;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-diff-server-"));
  await git("init", "-q", "-b", "main");

  await write("src/first.ts", "export const first = 1;\n");
  await commit("first");

  await write("src/second.ts", "export const second = 2;\n");
  await commit("second");

  // Uncommitted, so only a comparison against the working tree can see it.
  await write("src/scratch.ts", "export const scratch = 3;\n");

  const options: DiffScanOptions = {
    root,
    comparison: await resolveComparison(root, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" }),
    tokenizer: "cl100k_base",
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 2,
  };
  const index = await scanDiff(options);
  server = createSlopsplorerServer({ index, producer: { kind: "diff", options }, host: "127.0.0.1", port: 0, portAttempts: 1 });
  serverUrl = (await server.listen()).url;
}, SCAN_TIMEOUT_MS);

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe("comparing something else from the page", () => {
  it("takes the comparison the picker builds, not a line of argument text", async () => {
    const comparison: ComparisonRequest = { kind: "workingTree" };
    const response = await postCompare(comparison);
    expect(response.status).toBe(200);
    const view = await response.json() as ViewResponse;
    expect(view.meta.diff?.request).toEqual(comparison);
    expect(view.meta.diff?.target).toBe("working tree");
    // Against the working tree the untracked file counts, which the commit
    // pair could not see.
    expect(view.ranked.map((file) => file.path)).toContain("src/scratch.ts");
  });

  it("keeps the repository, so only the comparison moves", async () => {
    const response = await postCompare({ kind: "mergeBase", base: "HEAD~1", target: "HEAD" });
    expect(response.status).toBe(200);
    const view = await response.json() as ViewResponse;
    expect(view.meta.rootPath).toBe(root);
    expect(view.meta.diff?.spec).toBe("HEAD~1...HEAD");
    expect(view.ranked.map((file) => file.path)).toEqual(["src/second.ts"]);
  });

  it("refuses a revision the repository does not hold, and keeps the active one", async () => {
    const before = await activeMeta();
    const response = await postCompare({ kind: "revisionToWorkingTree", rev: "no-such-revision" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "not a revision in this repository: no-such-revision",
    });
    expect((await activeMeta()).diff?.spec).toBe(before.diff?.spec);
  });

  it("refuses a comparison that is none of the five", async () => {
    const response = await postCompare({ kind: "whatever" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "`comparison.kind` must name one of the five comparisons",
    });
  });
});

describe("what the picker can offer", () => {
  it("lists the branches and tags of the compared repository, newest first", async () => {
    const response = await fetch(`${serverUrl}/api/refs`);
    expect(response.status).toBe(200);
    const refs = await response.json() as RepositoryRefs;
    expect(refs.headBranch).toBe("main");
    expect(refs.refs).toEqual([{ name: "main", kind: "branch", shortSha: refs.headSha }]);
  });
}, SCAN_TIMEOUT_MS);

describe("the preview of one compared file", () => {
  const committed = Array.from({ length: 8 }, (_, index) => `export const line${index} = ${index};`);

  it("sends the whole file as aligned lines, with a number on each side", async () => {
    await write("src/preview.ts", `${committed.join("\n")}\n`);
    await commit("preview");
    const edited = [...committed];
    edited[3] = "export const line3 = 30;";
    await write("src/preview.ts", `${edited.join("\n")}\n`);

    expect((await postCompare({ kind: "workingTree" })).status).toBe(200);
    const response = await fetch(`${serverUrl}/api/source?path=src/preview.ts`);
    expect(response.status).toBe(200);
    const source = await response.json() as Extract<SourceResponse, { mode: "diff" }>;
    expect(source).toMatchObject({ mode: "diff", truncated: false });

    // Whole file, not a hunk: each side reads back exactly as it is on disk.
    expect(source.lines.filter((line) => line.marker !== "+").map((line) => line.text)).toEqual(committed);
    expect(source.lines.filter((line) => line.marker !== "-").map((line) => line.text)).toEqual(edited);
    expect(source.lines.filter((line) => line.marker === "-")).toEqual([
      { marker: "-", text: committed[3], beforeLine: 4, afterLine: null },
    ]);
    expect(source.lines.filter((line) => line.marker === "+")).toEqual([
      { marker: "+", text: edited[3], beforeLine: null, afterLine: 4 },
    ]);
    expect(source.lines[0]).toEqual({ marker: " ", text: committed[0], beforeLine: 1, afterLine: 1 });
  });
});

describe("the commits a comparison spans", () => {
  it("lists them for a range, measured one commit at a time", async () => {
    expect((await postCompare({ kind: "revisionPair", base: "HEAD~1", target: "HEAD" })).status).toBe(200);

    const response = await fetch(`${serverUrl}/api/spine`);
    expect(response.status).toBe(200);
    const spine = await response.json() as CommitSpine;
    const head = (await git("rev-parse", "HEAD")).trim();
    const subject = (await git("log", "-1", "--format=%s")).trim();
    expect(spine.commits.map((entry) => entry.sha)).toEqual([head]);
    expect(spine.commits[0]?.subject).toBe(subject);
    expect(spine.commits[0]?.addedLines).toBeGreaterThan(0);
    expect(spine.omitted).toBe(0);
    expect(spine.range).toEqual({ kind: "revisionPair", base: "HEAD~1", target: "HEAD" });
  }, SCAN_TIMEOUT_MS);

  /**
   * The bug this guards: a step opens a comparison of one commit, so a spine
   * rebuilt from the open comparison would list that one commit and the band
   * would collapse as the reader walked it.
   */
  it("stays the range's spine while a comparison inside the range is open", async () => {
    expect((await postCompare({ kind: "revisionPair", base: "HEAD~2", target: "HEAD" })).status).toBe(200);
    const range = await (await fetch(`${serverUrl}/api/spine`)).json() as CommitSpine;
    expect(range.commits.length).toBe(2);

    // Step onto the first commit of the range, as the band does.
    const step: ComparisonRequest = {
      kind: "revisionPair", base: range.base, target: range.commits[0]!.sha,
    };
    expect((await postCompare(step)).status).toBe(200);

    const stepped = await (await fetch(`${serverUrl}/api/spine`)).json() as CommitSpine;
    expect(stepped.commits.map((entry) => entry.sha)).toEqual(range.commits.map((entry) => entry.sha));
    expect(stepped.range).toEqual(range.range);
  }, SCAN_TIMEOUT_MS);

  it("has none when a side is the working tree, because neither end is a commit", async () => {
    expect((await postCompare({ kind: "workingTree" })).status).toBe(200);

    const response = await fetch(`${serverUrl}/api/spine`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
  }, SCAN_TIMEOUT_MS);
});
