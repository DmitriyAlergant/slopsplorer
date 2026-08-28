import { describe, expect, it } from "vitest";
import type { ComparisonRequest, DiffMeta, ScanMeta } from "../src/shared/api.ts";
import { aspectFigure, comparisonLabel, countOf, documentTitle, shortRevision } from "../src/web/format.ts";

const FULL_SHA = "87d1e8b76cece130474a7fcc6093528f3c20cd4c";

describe("countOf", () => {
  it("agrees with the noun", () => {
    expect(countOf(1, "file")).toBe("1 file");
    expect(countOf(0, "file")).toBe("0 files");
    expect(countOf(1234, "file")).toBe("1,234 files");
  });

  it("takes es after a sibilant", () => {
    expect(countOf(1, "match")).toBe("1 match");
    expect(countOf(128, "match")).toBe("128 matches");
  });
});

describe("shortRevision", () => {
  it("abbreviates a whole object name", () => {
    expect(shortRevision(FULL_SHA)).toBe("87d1e8b76c");
    expect(shortRevision(FULL_SHA.toUpperCase())).toBe("87D1E8B76C");
  });

  it("abbreviates a sha-256 object name", () => {
    expect(shortRevision("a".repeat(64))).toBe("aaaaaaaaaa");
  });

  // Anything shorter is already what someone typed, and cutting it further
  // could turn an unambiguous prefix into an ambiguous one.
  it("leaves a name that is not a whole object name alone", () => {
    expect(shortRevision("87d1e8b")).toBe("87d1e8b");
    expect(shortRevision("origin/main")).toBe("origin/main");
    expect(shortRevision("HEAD")).toBe("HEAD");
    expect(shortRevision(`${FULL_SHA}^`)).toBe(`${FULL_SHA}^`);
    expect(shortRevision("decade")).toBe("decade");
  });
});

describe("comparisonLabel", () => {
  it("names every comparison, with long revisions abbreviated", () => {
    expect(comparisonLabel({ kind: "workingTree" })).toBe("HEAD -> working tree");
    expect(comparisonLabel({ kind: "staged" })).toBe("HEAD -> index");
    expect(comparisonLabel({ kind: "revisionToWorkingTree", rev: FULL_SHA }))
      .toBe("87d1e8b76c -> working tree");
    expect(comparisonLabel({ kind: "revisionPair", base: "origin/main", target: FULL_SHA }))
      .toBe("origin/main -> 87d1e8b76c");
    expect(comparisonLabel({ kind: "mergeBase", base: "origin/main", target: "dev" }))
      .toBe("origin/main -> dev, from the merge base");
  });
});

function meta(rootName: string, request: ComparisonRequest | null): ScanMeta {
  const diff: DiffMeta | null = request === null ? null : {
    spec: "spec",
    request,
    base: "base",
    target: "target",
    filesAdded: 0,
    filesModified: 0,
    filesDeleted: 0,
    filesRenamed: 0,
    cappedFiles: 0,
  };
  return {
    rootPath: `/src/${rootName}`,
    rootName,
    tokenizer: "o200k_base",
    fileCount: 0,
    folderCount: 0,
    scannedAt: new Date().toISOString(),
    durationMs: 0,
    fileSource: request === null ? "git-index" : "git-diff",
    diff,
    skippedLargeFiles: 0,
    languages: [],
  };
}

describe("documentTitle", () => {
  it("names the scanned folder", () => {
    expect(documentTitle(meta("slopsplorer", null))).toBe("slopsplorer - Slopsplorer");
  });

  it("names the folder and the comparison, and says it is a diff", () => {
    expect(documentTitle(meta("slopsplorer", { kind: "workingTree" })))
      .toBe("slopsplorer: HEAD -> working tree - Slopsplorer diff");
    expect(documentTitle(meta("slopsplorer", { kind: "mergeBase", base: "origin/main", target: "dev" })))
      .toBe("slopsplorer: origin/main -> dev, from the merge base - Slopsplorer diff");
  });

  // A pull request is named as the picker names it, because the ref it is
  // fetched into is not what the reader asked for.
  it("names a pull request by its number", () => {
    const request: ComparisonRequest = {
      kind: "revisionPair",
      base: "origin/main",
      target: "refs/slopsplorer/pull/14",
    };
    expect(documentTitle(meta("slopsplorer", request)))
      .toBe("slopsplorer: origin/main -> PR 14 - Slopsplorer diff");
  });

  it("falls back to the product name before the first response", () => {
    expect(documentTitle(null)).toBe("Slopsplorer");
  });
});

describe("aspectFigure", () => {
  // A side keeps the direction of the side it names, whatever its own value is,
  // so the same figure reads the same in a strip, a tile, and a scope readout.
  it("signs each side by what it names", () => {
    expect(aspectFigure("added", 1200)).toEqual({ text: "+1,200", sign: "positive" });
    expect(aspectFigure("removed", 1200)).toEqual({ text: "-1,200", sign: "negative" });
  });

  it("signs net by its own direction", () => {
    expect(aspectFigure("net", 1200)).toEqual({ text: "+1,200", sign: "positive" });
    expect(aspectFigure("net", -1200)).toEqual({ text: "-1,200", sign: "negative" });
  });

  // Nothing has no direction, and a red "-0" reads as a broken figure.
  it("leaves nothing unsigned", () => {
    expect(aspectFigure("added", 0)).toEqual({ text: "0", sign: "zero" });
    expect(aspectFigure("removed", 0)).toEqual({ text: "0", sign: "zero" });
    expect(aspectFigure("net", 0)).toEqual({ text: "0", sign: "zero" });
  });

  it("leaves churn and the after-image as plain counts", () => {
    expect(aspectFigure("churn", 2400)).toEqual({ text: "2,400", sign: "none" });
    expect(aspectFigure("after", 2400)).toEqual({ text: "2,400", sign: "none" });
  });
});
