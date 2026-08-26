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
    treeSort: "name",
    drillPath: "",
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

  it("sorts each source-tree level by name or descending token weight", () => {
    const nameRows = buildView(index, request({ expanded: [""], treeSort: "name" })).tree
      .filter((row) => row.depth === 1);
    expect(nameRows.map((row) => row.name)).toEqual(
      nameRows.map((row) => row.name).sort((left, right) => left.localeCompare(right)),
    );

    const tokenRows = buildView(index, request({ expanded: [""], treeSort: "tokens" })).tree
      .filter((row) => row.depth === 1);
    expect(tokenRows.map((row) => row.tokens)).toEqual(
      tokenRows.map((row) => row.tokens).sort((left, right) => right - left),
    );
  });

  it("keeps token-sorted rows in place when their scope checkbox is cleared", () => {
    const order = (view: ReturnType<typeof buildView>): string[] => view.tree
      .filter((row) => row.depth === 1)
      .map((row) => `${row.rowKind}:${row.path}`);
    const included = buildView(index, request({ expanded: [""], treeSort: "tokens" }));
    const folderExcluded = buildView(index, request({
      expanded: [""],
      treeSort: "tokens",
      excludedFolders: ["src"],
    }));
    const directFilesExcluded = buildView(index, request({
      expanded: [""],
      treeSort: "tokens",
      excludedDirectFiles: [""],
    }));

    expect(order(folderExcluded)).toEqual(order(included));
    expect(order(directFilesExcluded)).toEqual(order(included));
    expect(folderRow(folderExcluded.tree, "src")!.tokens).toBe(0);
    expect(filesRow(directFilesExcluded.tree, "")!.tokens).toBe(0);
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

  it("keeps the project baseline fixed at the unfiltered total, so percentages stay comparable across filters", () => {
    const everything = buildView(index, request());
    const codeOnly = buildView(index, request({ kinds: ["code"] }));
    const withGenerated = buildView(index, request({ showGenerated: true }));

    const unfilteredTotal = index.files.reduce((total, file) => total + file.tokens, 0);
    expect(everything.summary.projectTokens).toBe(unfilteredTotal);
    expect(codeOnly.summary.projectTokens).toBe(unfilteredTotal);
    expect(withGenerated.summary.projectTokens).toBe(unfilteredTotal);
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
    expect(parsed.treeSort).toBe("name");
    expect(parsed.drillPath).toBe("");
    expect(parsed.selected).toEqual({ rowKind: "folder", path: "" });
    expect(parsed.rank).toEqual({ metric: "tokens", minTokens: 0, limit: 100 });
    expect(() => buildView(index, parsed)).not.toThrow();
  });

  it("refuses an unknown sort metric, so a request cannot choose which property gets indexed", () => {
    expect(parseViewRequest({ rank: { metric: "; DROP TABLE" } }).rank.metric).toBe("tokens");
    expect(parseViewRequest({ rank: { metric: "__proto__" } }).rank.metric).toBe("tokens");
    expect(parseViewRequest({ rank: { metric: "commentLines" } }).rank.metric).toBe("commentLines");
  });

  it("accepts only known source-tree sort orders", () => {
    expect(parseViewRequest({ treeSort: "tokens" }).treeSort).toBe("tokens");
    expect(parseViewRequest({ treeSort: "__proto__" }).treeSort).toBe("name");
  });

  it("keeps only known file kinds, in the canonical order", () => {
    expect(parseViewRequest({ kinds: ["other", "code", "__proto__", "nonsense"] }).kinds).toEqual(["code", "other"]);
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

describe("bar normalisation", () => {
  /**
   * The bars are normalised against unfiltered totals precisely so that this
   * holds. Normalising against the visible total grows the denominator when a
   * kind is enabled, which visibly shrinks any tile that holds none of it.
   */
  it("never shortens a bar when a file kind is switched on", () => {
    const progression: FileKind[][] = [
      ["code"],
      ["code", "test"],
      ["code", "test", "text"],
      ALL_KINDS,
    ];

    let previousCards = new Map<string, number>();
    let previousRows = new Map<string, number>();

    for (const kinds of progression) {
      const view = buildView(index, request({ kinds }));

      for (const card of view.detail.cards) {
        const key = card.path ?? card.name;
        const earlier = previousCards.get(key);
        if (earlier !== undefined) {
          expect(card.shareOfScope, `tile ${key} shrank after enabling a kind`)
            .toBeGreaterThanOrEqual(earlier - 1e-9);
        }
      }

      for (const row of view.tree) {
        const key = `${row.rowKind}:${row.path}`;
        const earlier = previousRows.get(key);
        if (earlier !== undefined) {
          expect(row.shareOfScope, `tree row ${key} shrank after enabling a kind`)
            .toBeGreaterThanOrEqual(earlier - 1e-9);
        }
      }

      previousCards = new Map(view.detail.cards.map((card) => [card.path ?? card.name, card.shareOfScope]));
      previousRows = new Map(view.tree.map((row) => [`${row.rowKind}:${row.path}`, row.shareOfScope]));
    }
  });

  it("measures a tile against the whole scope, so filtered tiles sum to less than one", () => {
    const everything = buildView(index, request());
    const codeOnly = buildView(index, request({ kinds: ["code"] }));

    const sum = (cards: readonly { shareOfScope: number }[]): number =>
      cards.reduce((total, card) => total + card.shareOfScope, 0);

    expect(sum(everything.detail.cards)).toBeGreaterThan(sum(codeOnly.detail.cards));
    expect(sum(everything.detail.cards)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("keeps a tile's bar fixed when a kind it does not contain is switched on", () => {
    // `src/deep` holds only TypeScript, so enabling docs must not move it.
    const codeOnly = buildView(index, request({ selected: { rowKind: "folder", path: "src" }, kinds: ["code"] }));
    const withDocs = buildView(index, request({ selected: { rowKind: "folder", path: "src" }, kinds: ["code", "text"] }));

    const deepBefore = codeOnly.detail.cards.find((card) => card.path === "src/deep");
    const deepAfter = withDocs.detail.cards.find((card) => card.path === "src/deep");

    expect(deepBefore).toBeDefined();
    expect(deepAfter).toBeDefined();
    expect(deepAfter!.shareOfScope).toBeCloseTo(deepBefore!.shareOfScope, 10);
  });

  it("uses one absolute baseline for every source-tree row", () => {
    const view = buildView(index, request());
    const deep = folderRow(view.tree, "src/deep")!;
    const deepFiles = filesRow(view.tree, "src/deep")!;

    expect(deep.tokens).toBe(deepFiles.tokens);
    expect(deep.shareOfScope).toBeCloseTo(deepFiles.shareOfScope, 10);
    expect(deep.shareOfScope).toBeCloseTo(deep.tokens / view.summary.projectTokens, 10);
  });
});

describe("drill scope", () => {
  it("makes a folder the common baseline for the main widgets without changing the project ribbon", () => {
    const project = buildView(index, request());
    const drilled = buildView(index, request({
      drillPath: "src",
      selected: { rowKind: "folder", path: "src/deep" },
      expanded: ["src", "src/deep"],
    }));

    expect(drilled.tree[0]).toMatchObject({ rowKind: "folder", path: "src", depth: 0 });
    expect(drilled.tree.every((row) => row.path === "src" || row.path.startsWith("src/"))).toBe(true);
    expect(drilled.summary.projectTokens).toBe(project.summary.projectTokens);
    expect(drilled.summary.ribbon).toEqual(project.summary.ribbon);

    const scopeTokens = tokensOf("src/main.ts", "src/util.ts", "src/deep/helper.ts");
    const deep = folderRow(drilled.tree, "src/deep")!;
    expect(deep.shareOfScope).toBeCloseTo(deep.tokens / scopeTokens, 10);
    expect(drilled.detail.shareOfScope).toBeCloseTo(deep.tokens / scopeTokens, 10);
    expect(drilled.detail.shareOfProject).toBeCloseTo(deep.tokens / project.summary.projectTokens, 10);
  });

  it("falls back to the drill root when a stale selection lies outside the scope", () => {
    const view = buildView(index, request({
      drillPath: "src",
      selected: { rowKind: "folder", path: "tests" },
      expanded: ["src"],
    }));

    expect(view.detail.title).toBe("src");
    expect(view.rankScope).toBe("src");
    expect(view.tree[0]!.selected).toBe(true);
  });
});

describe("ranking scope", () => {
  it("ranks only files inside the selected folder, so the panel label is truthful", () => {
    const wholeTree = buildView(index, request());
    const justSrc = buildView(index, request({ selected: { rowKind: "folder", path: "src" } }));

    expect(wholeTree.ranked.some((file) => file.path.startsWith("tests/"))).toBe(true);
    expect(justSrc.ranked.length).toBeGreaterThan(0);
    expect(justSrc.ranked.every((file) => file.path.startsWith("src/"))).toBe(true);
    expect(justSrc.rankedTotal).toBeLessThan(wholeTree.rankedTotal);
    expect(justSrc.rankScope).toBe("src");
  });

  it("narrows to a folder's own files when the (files) row is selected", () => {
    const subtree = buildView(index, request({ selected: { rowKind: "folder", path: "src" } }));
    const directOnly = buildView(index, request({ selected: { rowKind: "files", path: "src" } }));

    expect(subtree.ranked.some((file) => file.path.startsWith("src/deep/"))).toBe(true);
    expect(directOnly.ranked.every((file) => file.path.lastIndexOf("/") === "src".length)).toBe(true);
    expect(directOnly.rankScope).toBe("src/(files)");
  });

  it("still honours the visibility switches inside the selected folder", () => {
    const all = buildView(index, request({ selected: { rowKind: "folder", path: "" } }));
    const noTests = buildView(index, request({ selected: { rowKind: "folder", path: "" }, kinds: ["code"] }));

    expect(all.ranked.some((file) => file.path.startsWith("tests/"))).toBe(true);
    expect(noTests.ranked.some((file) => file.path.startsWith("tests/"))).toBe(false);
  });
});

describe("headline figures", () => {
  it("stays project-level when an ordinary folder or direct-files row is selected", () => {
    const whole = buildView(index, request());
    const srcOnly = buildView(index, request({ selected: { rowKind: "folder", path: "src" } }));
    const directOnly = buildView(index, request({ selected: { rowKind: "files", path: "src" } }));

    expect(srcOnly.summary).toEqual(whole.summary);
    expect(directOnly.summary).toEqual(whole.summary);
  });

  it("counts a selected flavor project-wide even when the detail folder contains none of it", () => {
    const view = buildView(index, request({
      kinds: ["text"],
      selected: { rowKind: "folder", path: "src/deep" },
    }));

    expect(view.detail.tokens).toBe(0);
    expect(view.summary.selectedTokens).toBe(tokensOf("README.md"));
    expect(view.summary.selectedFiles).toBe(1);
  });

  it("follows visibility switches without following ordinary folder navigation", () => {
    const rootAll = buildView(index, request());
    const rootCode = buildView(index, request({ kinds: ["code"] }));
    const srcCode = buildView(index, request({ selected: { rowKind: "folder", path: "src" }, kinds: ["code"] }));
    const deepCode = buildView(index, request({ selected: { rowKind: "folder", path: "src/deep" }, kinds: ["code"] }));

    expect(rootCode.summary.selectedTokens).toBeLessThan(rootAll.summary.selectedTokens);
    expect(srcCode.summary.selectedTokens).toBe(rootCode.summary.selectedTokens);
    expect(deepCode.summary.selectedTokens).toBe(rootCode.summary.selectedTokens);
  });
});

describe("folder tile grid", () => {
  /** The fixture root holds src, tests, dist plus loose files. */
  it("keeps the measured column capacity when fewer folders are present", () => {
    for (const cardColumns of [1, 2, 3, 4, 5, 6]) {
      const view = buildView(index, request({ cardColumns, showGenerated: true }));
      expect(view.detail.cardColumns).toBe(cardColumns);
      expect(view.detail.cards.length).toBeLessThanOrEqual(cardColumns * 2);
    }
  });

  it("does not stretch a few cards to fill the panel", () => {
    // The root has three child folders once generated output is shown.
    const view = buildView(index, request({ cardColumns: 6, showGenerated: true }));
    expect(view.detail.cardColumns).toBe(6);
    expect(view.detail.cards.length).toBe(3);
    expect(view.detail.cards.some((card) => card.path === null)).toBe(false);
  });

  it("keeps every folder's weight in the totals even when tiles are collapsed", () => {
    const wide = buildView(index, request({ cardColumns: 6, showGenerated: true }));
    const narrow = buildView(index, request({ cardColumns: 2, showGenerated: true }));
    const sum = (cards: readonly { tokens: number }[]): number =>
      cards.reduce((total, card) => total + card.tokens, 0);
    expect(sum(narrow.detail.cards)).toBe(sum(wide.detail.cards));
  });
});

describe("folder heading", () => {
  it("does not repeat the folder name in the trail above it", () => {
    const nested = buildView(index, request({ selected: { rowKind: "folder", path: "src/deep" } }));
    expect(nested.detail.title).toBe("deep");
    expect(nested.detail.breadcrumb).toBe(`${index.meta.rootName}/src`);
    expect(nested.detail.breadcrumb.endsWith(nested.detail.title)).toBe(false);
  });

  it("leaves the trail empty at the root, where the heading is the whole path", () => {
    const root = buildView(index, request());
    expect(root.detail.title).toBe(index.meta.rootName);
    expect(root.detail.breadcrumb).toBe("");
  });

  it("keeps the full folder path in the trail when its own files are selected", () => {
    const direct = buildView(index, request({ selected: { rowKind: "files", path: "src/deep" } }));
    expect(direct.detail.title).toBe("(files)");
    expect(direct.detail.breadcrumb).toBe(`${index.meta.rootName}/src/deep`);
  });
});
