import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FileKind, TreeRow, ViewRequest } from "../src/shared/api.ts";
import { scanSourceTree, type ScanIndex } from "../src/scanner/scan.ts";
import { buildView, parseViewRequest } from "../src/server/aggregate.ts";

const SCAN_TIMEOUT_MS = 60_000;

const ALL_KINDS: FileKind[] = ["code", "test", "text", "i18n", "data", "other"];

const MAIN_TS = `export interface Job {
  id: string;
  attempts: number;
}

export function schedule(jobs: Job[], limit: number): Job[] {
  const queue: Job[] = [];
  for (const job of jobs) {
    if (job.attempts < limit) {
      queue.push(job);
    }
  }
  return queue;
}

export function summarise(jobs: Job[]): string {
  const parts = jobs.map((job) => job.id + ":" + String(job.attempts));
  return parts.join(", ");
}

export function retry(job: Job): Job {
  return { id: job.id, attempts: job.attempts + 1 };
}

export function reset(jobs: Job[]): Job[] {
  return jobs.map((job) => ({ id: job.id, attempts: 0 }));
}

export function longest(jobs: Job[]): Job | null {
  let best: Job | null = null;
  for (const job of jobs) {
    if (best === null || job.attempts > best.attempts) {
      best = job;
    }
  }
  return best;
}
`;

const UTIL_TS = `// Utility constants.
// Documented at unusual length, the way template-expanded
// or model-written modules tend to be.
// Fourth line of commentary.
// Fifth line of commentary.
// Sixth line of commentary.
// Seventh line of commentary.
// Eighth line of commentary.
// Ninth line of commentary.
// Tenth line of commentary.
export const ONE = 1;
export const TWO = 2;
`;

const FIXTURE = {
  "README.md": "# Fixture\n\nA small tree used to exercise the aggregator.\n",
  "src/main.ts": MAIN_TS,
  "src/util.ts": UTIL_TS,
  "src/deep/helper.ts": "export const helper = (value: number): number => value + 1;\n",
  "tests/main.test.ts": "import { schedule } from \"../src/main.ts\";\n\nit(\"schedules\", () => {\n  expect(schedule([], 1)).toEqual([]);\n});\n",
  "dist/bundle.js": "var a=1,b=2;console.log(a+b);\n",
};

let root: string;
let index: ScanIndex;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-aggregate-"));
  for (const [relativePath, contents] of Object.entries(FIXTURE)) {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
  index = await scanSourceTree({
    root,
    tokenizer: "cl100k_base",
    allFiles: true,
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 8,
  });
}, SCAN_TIMEOUT_MS);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A complete, fully expanded request, so a test only states what it changes. */
function request(overrides: Partial<ViewRequest> = {}): ViewRequest {
  return parseViewRequest({
    kinds: ALL_KINDS,
    showGenerated: false,
    query: "",
    excludedFolders: [],
    excludedDirectFiles: [],
    expanded: ["", "src", "src/deep", "tests", "dist"],
    selected: { rowKind: "folder", path: "" },
    rank: { metric: "tokens", minTokens: 0, limit: 100 },
    ...overrides,
  });
}

function tokensOf(...paths: string[]): number {
  return paths.reduce((total, filePath) => {
    const file = index.files.find((row) => row.path === filePath);
    expect(file, `fixture file ${filePath}`).toBeDefined();
    return total + file!.tokens;
  }, 0);
}

function folderRow(rows: readonly TreeRow[], folderPath: string): TreeRow | undefined {
  return rows.find((row) => row.rowKind === "folder" && row.path === folderPath);
}

function filesRow(rows: readonly TreeRow[], folderPath: string): TreeRow | undefined {
  return rows.find((row) => row.rowKind === "files" && row.path === folderPath);
}

describe("folder aggregation", () => {
  it("reports a folder's weight as exactly the sum of the files beneath it", () => {
    const view = buildView(index, request());
    const src = folderRow(view.tree, "src")!;
    expect(src.tokens).toBe(tokensOf("src/main.ts", "src/util.ts", "src/deep/helper.ts"));
    const deep = folderRow(view.tree, "src/deep")!;
    expect(deep.tokens).toBe(tokensOf("src/deep/helper.ts"));
    expect(filesRow(view.tree, "src")!.tokens).toBe(tokensOf("src/main.ts", "src/util.ts"));
  });

  it("adds the top-level folders and the root's loose files back up to the selected total", () => {
    const view = buildView(index, request());
    expect(view.summary.selectedTokens).toBe(
      tokensOf("README.md", "src/main.ts", "src/util.ts", "src/deep/helper.ts", "tests/main.test.ts"),
    );
    const ribbonTotal = view.summary.ribbon.reduce((total, card) => total + card.tokens, 0);
    expect(ribbonTotal).toBe(view.summary.selectedTokens);
    expect(view.summary.selectedFiles).toBe(5);
  });
});

describe("visibility switches", () => {
  it("hiding a file kind removes its weight from the totals and its folder from the tree", () => {
    const withTests = buildView(index, request());
    const withoutTests = buildView(index, request({ kinds: ["code", "text", "i18n", "data", "other"] }));
    expect(withoutTests.summary.selectedTokens).toBe(
      withTests.summary.selectedTokens - tokensOf("tests/main.test.ts"),
    );
    expect(folderRow(withTests.tree, "tests")).toBeDefined();
    expect(folderRow(withoutTests.tree, "tests")).toBeUndefined();
  });

  it("generated output is left out of the totals until it is asked for", () => {
    const hidden = buildView(index, request());
    const shown = buildView(index, request({ showGenerated: true }));
    expect(folderRow(hidden.tree, "dist")).toBeUndefined();
    expect(folderRow(shown.tree, "dist")!.tokens).toBe(tokensOf("dist/bundle.js"));
    expect(shown.summary.selectedTokens).toBe(hidden.summary.selectedTokens + tokensOf("dist/bundle.js"));
  });

  it("keeps the project baseline fixed at the hand-written total, so percentages stay comparable across filters", () => {
    const baseline = tokensOf("README.md", "src/main.ts", "src/util.ts", "src/deep/helper.ts", "tests/main.test.ts");
    for (const view of [
      buildView(index, request()),
      buildView(index, request({ showGenerated: true })),
      buildView(index, request({ kinds: ["code"] })),
      buildView(index, request({ excludedFolders: ["src"] })),
    ]) {
      expect(view.summary.projectTokens).toBe(baseline);
    }
  });
});

describe("scope exclusions", () => {
  it("excluding a folder zeroes it, disables its descendants, and leaves the ancestor partially selected", () => {
    const view = buildView(index, request({ excludedFolders: ["src"] }));
    const src = folderRow(view.tree, "src")!;
    expect(src.tokens).toBe(0);
    expect(src.included).toBe(false);
    expect(src.disabled).toBe(false);

    const deep = folderRow(view.tree, "src/deep")!;
    expect(deep.disabled).toBe(true);
    expect(deep.tokens).toBe(0);
    expect(filesRow(view.tree, "src")!.disabled).toBe(true);

    const projectRoot = folderRow(view.tree, "")!;
    expect(projectRoot.indeterminate).toBe(true);
    expect(projectRoot.included).toBe(true);
    expect(view.summary.selectedTokens).toBe(tokensOf("README.md", "tests/main.test.ts"));
  });

  it("excluding a folder's loose files leaves its subfolders counted", () => {
    const view = buildView(index, request({ excludedDirectFiles: ["src"] }));
    expect(folderRow(view.tree, "src")!.tokens).toBe(tokensOf("src/deep/helper.ts"));
    expect(filesRow(view.tree, "src")!.included).toBe(false);
    expect(folderRow(view.tree, "src")!.indeterminate).toBe(true);
    expect(view.summary.selectedTokens).toBe(
      tokensOf("README.md", "src/deep/helper.ts", "tests/main.test.ts"),
    );
  });
});

describe("search", () => {
  it("narrows the tree to matching paths and opens it up so the matches are visible without clicking", () => {
    const view = buildView(index, request({ query: "helper", expanded: [] }));
    expect(view.ranked.map((file) => file.path)).toEqual(["src/deep/helper.ts"]);
    expect(view.summary.selectedTokens).toBe(tokensOf("src/deep/helper.ts"));
    expect(folderRow(view.tree, "tests")).toBeUndefined();
    expect(folderRow(view.tree, "src/deep")).toBeDefined();
    for (const row of view.tree.filter((candidate) => candidate.rowKind === "folder")) {
      expect(row.expanded, `folder row "${row.path}" should render expanded during a search`).toBe(true);
    }
  });

  it("matches anywhere in the path, not just the file name", () => {
    const view = buildView(index, request({ query: "src/" }));
    expect(view.ranked.map((file) => file.path).sort()).toEqual([
      "src/deep/helper.ts", "src/main.ts", "src/util.ts",
    ]);
  });
});

describe("file ranking", () => {
  it("ranks by the chosen metric, so a comment-heavy file can top the list a token ranking would bury", () => {
    const byTokens = buildView(index, request({ rank: { metric: "tokens", minTokens: 0, limit: 100 } }));
    expect(byTokens.ranked[0]!.path).toBe("src/main.ts");

    const byComments = buildView(index, request({ rank: { metric: "commentLines", minTokens: 0, limit: 100 } }));
    expect(byComments.ranked[0]!.path).toBe("src/util.ts");
    expect(byComments.ranked[0]!.commentLines).toBe(10);
  });

  it("drops files below the token floor so a long tail of tiny files does not crowd out the real weight", () => {
    const helper = index.files.find((file) => file.path === "src/deep/helper.ts")!;
    const view = buildView(index, request({
      rank: { metric: "tokens", minTokens: helper.tokens + 1, limit: 100 },
    }));
    expect(view.ranked.map((file) => file.path)).not.toContain("src/deep/helper.ts");
    expect(view.ranked.map((file) => file.path)).toContain("src/main.ts");
    expect(view.rankedTotal).toBe(view.ranked.length);
  });

  it("truncates the list but still reports how many files matched, so the count is not a lie", () => {
    const view = buildView(index, request({ rank: { metric: "tokens", minTokens: 0, limit: 2 } }));
    expect(view.ranked).toHaveLength(2);
    expect(view.rankedTotal).toBe(5);
  });

  it("ranks only what is in scope, so an excluded folder cannot reappear in the top-files list", () => {
    const view = buildView(index, request({ excludedFolders: ["src"] }));
    expect(view.ranked.map((file) => file.path).sort()).toEqual(["README.md", "tests/main.test.ts"]);
  });
});

describe("request parsing", () => {
  it("turns a missing body into a complete request instead of throwing on the first property access", () => {
    const parsed = parseViewRequest(null);
    expect(parsed.kinds).toEqual([]);
    expect(parsed.showGenerated).toBe(false);
    expect(parsed.query).toBe("");
    expect(parsed.excludedFolders).toEqual([]);
    expect(parsed.excludedDirectFiles).toEqual([]);
    expect(parsed.expanded).toEqual([]);
    expect(parsed.selected).toEqual({ rowKind: "folder", path: "" });
    expect(parsed.rank).toEqual({ metric: "tokens", minTokens: 0, limit: 100 });
    expect(() => buildView(index, parsed)).not.toThrow();
  });

  it("refuses an unknown sort metric, so a request cannot choose which property gets indexed", () => {
    expect(parseViewRequest({ rank: { metric: "; DROP TABLE" } }).rank.metric).toBe("tokens");
    expect(parseViewRequest({ rank: { metric: "__proto__" } }).rank.metric).toBe("tokens");
    expect(parseViewRequest({ rank: { metric: "commentLines" } }).rank.metric).toBe("commentLines");
  });

  it("discards list fields that are not lists of strings rather than trusting the shape", () => {
    const parsed = parseViewRequest({
      kinds: "code",
      excludedFolders: { src: true },
      expanded: ["src", 7, null, "tests"],
      selected: "root",
    });
    expect(parsed.kinds).toEqual([]);
    expect(parsed.excludedFolders).toEqual([]);
    expect(parsed.expanded).toEqual(["src", "tests"]);
    expect(parsed.selected).toEqual({ rowKind: "folder", path: "" });
  });

  it("clamps the result limit into range so a hostile value cannot ask for the whole index", () => {
    expect(parseViewRequest({ rank: { limit: 10_000_000 } }).rank.limit).toBe(1000);
    expect(parseViewRequest({ rank: { limit: -5 } }).rank.limit).toBe(1);
    expect(parseViewRequest({ rank: { limit: Number.NaN } }).rank.limit).toBe(100);
    expect(parseViewRequest({ rank: { limit: "many" } }).rank.limit).toBe(100);
    expect(parseViewRequest({ rank: { minTokens: -42 } }).rank.minTokens).toBe(0);
  });
});
