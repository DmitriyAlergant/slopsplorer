import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanDiff } from "../src/scanner/diffScan.ts";
import { resolveComparison } from "../src/scanner/gitdiff.ts";
import { scanSourceTree, type ScanIndex } from "../src/scanner/scan.ts";
import { buildView, parseViewRequest } from "../src/server/aggregate.ts";
import { ASPECTS, DIFF_RANK_METRICS, WEIGHT_FIELD_NAMES } from "../src/shared/api.ts";
import type { Aspect, FileKind, Measure, RankMetric, TreeRow, ViewRequest } from "../src/shared/api.ts";

const execFileAsync = promisify(execFile);
const SCAN_TIMEOUT_MS = 60_000;
const ALL_KINDS: FileKind[] = ["code", "test", "text", "i18n", "data", "other"];

let root: string;
let diffIndex: ScanIndex;
let scanIndex: ScanIndex;

async function git(...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
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

function lines(prefix: string, count: number): string {
  return `${Array.from({ length: count }, (_, index) => `export const ${prefix}${index} = ${index};`).join("\n")}\n`;
}

function request(overrides: Partial<ViewRequest> = {}): ViewRequest {
  return parseViewRequest({
    kinds: ALL_KINDS,
    measure: "lines" satisfies Measure,
    aspect: "churn" satisfies Aspect,
    showGenerated: true,
    expanded: ["", "grown", "shrunk"],
    treeSort: "weight",
    rank: { metric: "churn" satisfies RankMetric, minWeight: 0, limit: 100, offset: 0 },
    ...overrides,
  });
}

function rowFor(tree: readonly TreeRow[], folderPath: string): TreeRow {
  const row = tree.find((candidate) => candidate.path === folderPath && candidate.rowKind === "folder");
  if (row === undefined) throw new Error(`no tree row for ${folderPath}`);
  return row;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-diffview-"));
  await git("init", "-q", "-b", "main");
  // One folder that only grows and one that only shrinks, so a net total is
  // positive on one side of the tree and negative on the other.
  await write("grown/module.ts", lines("keep", 10));
  await write("shrunk/module.ts", lines("drop", 40));
  await commit("base");

  await write("grown/module.ts", lines("keep", 10) + lines("extra", 30));
  await write("shrunk/module.ts", lines("drop", 5));
  await commit("change");

  const comparison = await resolveComparison(root, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" });
  const options = { tokenizer: "cl100k_base" as const, exclude: [], maxFileBytes: 2 * 1024 * 1024, concurrency: 4 };
  diffIndex = await scanDiff({ root, comparison, ...options });
  scanIndex = await scanSourceTree({ root, allFiles: false, ...options });
}, SCAN_TIMEOUT_MS);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("aggregating a diff", () => {
  it("adds a subtree's churn and net out of its files, with both identities intact", () => {
    const view = buildView(diffIndex, request({ aspect: "churn" }));
    expect(rowFor(view.tree, "grown").weight).toBe(30);
    expect(rowFor(view.tree, "shrunk").weight).toBe(35);
    expect(view.summary.selectedWeight).toBe(65);
    expect(view.summary.selectedAdded + view.summary.selectedRemoved).toBe(view.summary.selectedWeight);
  });

  it("keeps net signed, so a folder that shrank reads as a loss rather than as work", () => {
    const view = buildView(diffIndex, request({ aspect: "net" }));
    expect(rowFor(view.tree, "grown").weight).toBe(30);
    expect(rowFor(view.tree, "shrunk").weight).toBe(-35);
    expect(view.summary.selectedWeight).toBe(-5);
  });

  /**
   * The invariant net would otherwise break: a share against a signed whole
   * lets a part exceed all of it, and explodes when adds and deletes cancel.
   * Here the scope's net is -5 while its parts are 30 and -35.
   */
  it("draws every net share against the scope's churn, which is the only positive whole", () => {
    const view = buildView(diffIndex, request({ aspect: "net" }));
    expect(view.summary.scopeWeight).toBe(65);
    for (const row of view.tree) {
      expect(row.shareOfScope).toBeGreaterThanOrEqual(0);
      expect(row.shareOfScope).toBeLessThanOrEqual(1);
    }
    expect(rowFor(view.tree, "shrunk").shareOfScope).toBeCloseTo(35 / 65, 6);
    expect(rowFor(view.tree, "grown").shareOfScope).toBeCloseTo(30 / 65, 6);
  });

  /**
   * The band is the only place a net row states what it cost, so it has to be
   * drawn at a readable length in every view, not only in an unfiltered one.
   */
  it("divides every band by the churn the filters leave, so one length means one quantity", () => {
    const view = buildView(diffIndex, request({ aspect: "net" }));

    // The scope's own row is the whole of it, so its band fills both halves.
    const scope = rowFor(view.tree, "");
    expect(scope.shareAdded + scope.shareRemoved).toBeCloseTo(1, 6);
    expect(rowFor(view.tree, "grown").shareAdded).toBeCloseTo(30 / 65, 6);
    expect(rowFor(view.tree, "shrunk").shareRemoved).toBeCloseTo(35 / 65, 6);

    // Narrowed to one folder, the bands divide what is left rather than what
    // the scan found, or a filtered view would draw every band at nothing.
    const narrowed = buildView(diffIndex, request({ aspect: "net", query: "grown" }));
    const grown = rowFor(narrowed.tree, "grown");
    expect(grown.shareAdded).toBe(1);
    expect(grown.shareRemoved).toBe(0);
    // The share divides by the same filtered churn, so the one folder the query
    // leaves is the whole of what the page is showing.
    expect(grown.shareOfScope).toBe(1);
  });

  it("orders by magnitude in net, so the largest deletion is not sorted last", () => {
    const view = buildView(diffIndex, request({ aspect: "net", rank: { metric: "net", minWeight: 0, limit: 100, offset: 0 } }));
    expect(view.ranked.map((file) => file.path)).toEqual(["shrunk/module.ts", "grown/module.ts"]);
    const children = view.tree.filter((row) => row.depth === 1 && row.rowKind === "folder");
    expect(children.map((row) => row.name)).toEqual(["shrunk", "grown"]);
  });

  it("floors the ranking on magnitude, so a threshold does not silently drop deletions", () => {
    const view = buildView(diffIndex, request({ aspect: "net", rank: { metric: "net", minWeight: 32, limit: 100, offset: 0 } }));
    expect(view.ranked.map((file) => file.path)).toEqual(["shrunk/module.ts"]);
  });

  it("carries the added and removed halves beside the weight, so a bar can split", () => {
    const view = buildView(diffIndex, request({ aspect: "net" }));
    const shrunk = rowFor(view.tree, "shrunk");
    expect({ added: shrunk.added, removed: shrunk.removed }).toEqual({ added: 0, removed: 35 });
    const card = view.summary.ribbon.find((segment) => segment.name === "grown")!;
    expect({ added: card.added, removed: card.removed }).toEqual({ added: 30, removed: 0 });
  });

  it("keeps the direct-files tile at one-column capacity", () => {
    const view = buildView(diffIndex, request({ cardColumns: 1, selected: { rowKind: "folder", path: "" } }));
    expect(view.detail.cards).toHaveLength(1);
    expect(view.detail.cards[0]).toMatchObject({ name: ".", rowKind: "files", files: 0, weight: 0 });
  });

  it("splits a folder tile by flavor inside a comparison too", () => {
    const view = buildView(diffIndex, request({ cardColumns: 3, selected: { rowKind: "folder", path: "" } }));
    const card = view.detail.cards.find((entry) => entry.name === "grown")!;
    expect(card.flavors).toEqual([{ flavor: "code", weight: 30 }]);
  });

  it("holds the tile baseline still when a flavor is turned off, so bars only shorten", () => {
    const all = buildView(diffIndex, request({ cardColumns: 3, selected: { rowKind: "folder", path: "" } }));
    const withoutCode = buildView(diffIndex, request({ cardColumns: 3, kinds: [], selected: { rowKind: "folder", path: "" } }));
    expect(withoutCode.detail.flavorBaseline).toBe(all.detail.flavorBaseline);
    const before = all.detail.cards.find((entry) => entry.name === "grown")!;
    expect(before.flavors).not.toEqual([]);
    const after = withoutCode.detail.cards.find((entry) => entry.name === "grown");
    expect(after?.flavors ?? []).toEqual([]);
  });
});

/**
 * The after-image of the files a change touched is not one of them: it is
 * neither the change nor the repository, and the review's After view answers
 * what the repository holds now.
 */
describe("the sides a comparison offers", () => {
  it("offers four, and draws a column for each", () => {
    expect(ASPECTS).toEqual(["added", "removed", "net", "churn"]);
    expect(DIFF_RANK_METRICS).not.toContain("after");
  });

  it("still measures every scanned after-image, which no side names", () => {
    expect(WEIGHT_FIELD_NAMES).toContain("tokens");
    expect(WEIGHT_FIELD_NAMES).toContain("lines");
    expect(WEIGHT_FIELD_NAMES).toContain("codeLines");
  });

  // Every request reaches an index through this gate, on the server and in the
  // snapshot worker, so a stale link cannot put the page on a side it no longer
  // draws a control for.
  it("refuses a request that names the after-image as a side or a column", () => {
    const parsed = parseViewRequest({ aspect: "after", rank: { metric: "after" } });
    expect(parsed.aspect).toBe("net");
    expect(parsed.rank.metric).toBe("tokens");
    // The mode clamp then moves that column to the one a comparison opens on.
    expect(buildView(diffIndex, { ...request(), ...parsed }).rankMetric).toBe("net");
  });
});

describe("aggregating a scan the same way", () => {
  it("ignores the aspect entirely, because a scanned file has only one content", () => {
    const view = buildView(scanIndex, request({ aspect: "net" }));
    expect(view.aspect).toBe("after");
    expect(view.summary.selectedWeight).toBeGreaterThan(0);
    expect(view.summary.selectedAdded).toBe(0);
  });

  /**
   * A stored preference or a pasted link can name a column the open index does
   * not draw. Clamping in one place is what keeps the caret under a real
   * heading instead of under nothing.
   */
  it("clamps a sorted column the open index cannot draw, and echoes what it used", () => {
    expect(buildView(scanIndex, request({ rank: { metric: "churn", minWeight: 0, limit: 100, offset: 0 } })).rankMetric)
      .toBe("tokens");
    expect(buildView(diffIndex, request({ rank: { metric: "commentLines", minWeight: 0, limit: 100, offset: 0 } })).rankMetric)
      .toBe("net");
    expect(buildView(diffIndex, request({ rank: { metric: "functions", minWeight: 0, limit: 100, offset: 0 } })).rankMetric)
      .toBe("functions");
    // The file column stands in both modes, so neither clamps a name sort away.
    expect(buildView(scanIndex, request({ rank: { metric: "name", minWeight: 0, limit: 100, offset: 0 } })).rankMetric)
      .toBe("name");
    expect(buildView(diffIndex, request({ rank: { metric: "name", minWeight: 0, limit: 100, offset: 0 } })).rankMetric)
      .toBe("name");
  });
});
