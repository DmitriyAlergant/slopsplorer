import { describe, expect, it } from "vitest";
import type { CommitSpine, SpineEntry } from "../src/shared/api.ts";
import {
  chainedSpan, requestForSpan, sameComparisonRequest, slideSpan, spanBetween, spanOf, spansRequest,
} from "../src/shared/api.ts";
import { heaviestChurn, sidesOf } from "../src/web/spine.ts";

function entry(sha: string, parent: string, added: number, removed: number): SpineEntry {
  return {
    kind: "commit",
    sha,
    shortSha: sha.slice(0, 7),
    parent,
    subject: `work on ${sha}`,
    body: "",
    url: null,
    author: "Test",
    date: "2026-01-01T00:00:00Z",
    files: 1,
    addedTokens: added * 4,
    removedTokens: removed * 4,
    addedLines: added,
    removedLines: removed,
    addedCodeLines: added,
    removedCodeLines: removed,
  };
}

function workingTree(parent: string, added: number, removed: number): SpineEntry {
  return {
    kind: "workingTree",
    parent,
    subject: "Uncommitted changes",
    body: "",
    files: 1,
    addedTokens: added * 4,
    removedTokens: removed * 4,
    addedLines: added,
    removedLines: removed,
    addedCodeLines: added,
    removedCodeLines: removed,
  };
}

const spine: CommitSpine = {
  range: { kind: "revisionPair", base: "base0", target: "head" },
  commits: [entry("c1", "base0", 10, 0), entry("c2", "c1", 4, 6), entry("c3", "c2", 1, 1)],
  omitted: 0,
};

/**
 * A range that holds a commit a merge brought in.
 *
 * `m1` sits on the line that was merged, so it does not follow `c1` and `c2`
 * does not follow it. The list is what the range holds, and it is not a chain.
 */
const merged: CommitSpine = {
  range: { kind: "revisionPair", base: "base0", target: "head" },
  commits: [entry("c1", "base0", 10, 0), entry("m1", "other", 4, 6), entry("c2", "c1", 1, 1)],
  omitted: 0,
};

const withWorkingTree: CommitSpine = {
  range: { kind: "revisionToWorkingTree", rev: "base0" },
  commits: [entry("c1", "base0", 10, 0), entry("head", "c1", 4, 6), workingTree("head", 3, 1)],
  omitted: 0,
};

describe("requestForSpan", () => {
  it("starts a span at the first commit from the range's own base", () => {
    expect(requestForSpan(spine, { start: 0, end: 0 }))
      .toEqual({ kind: "revisionPair", base: "base0", target: "c1" });
  });

  it("starts a later span from the commit before it", () => {
    expect(requestForSpan(spine, { start: 1, end: 2 }))
      .toEqual({ kind: "revisionPair", base: "c1", target: "c3" });
  });

  it("makes one commit and a run of commits the same kind of request", () => {
    expect(requestForSpan(spine, { start: 2, end: 2 }))
      .toEqual({ kind: "revisionPair", base: "c2", target: "c3" });
  });

  it("uses the working tree as the target of a span that reaches the final entry", () => {
    expect(requestForSpan(withWorkingTree, { start: 2, end: 2 }))
      .toEqual({ kind: "revisionToWorkingTree", rev: "head" });
    expect(requestForSpan(withWorkingTree, { start: 1, end: 2 }))
      .toEqual({ kind: "revisionToWorkingTree", rev: "c1" });
  });

  /**
   * The commit before a merged-in one is on another line, so comparing from it
   * would draw that whole line beside the one commit that was asked for.
   */
  it("compares a merged-in commit against its own parent", () => {
    expect(requestForSpan(merged, { start: 1, end: 1 }))
      .toEqual({ kind: "revisionPair", base: "other", target: "m1" });
    expect(requestForSpan(merged, { start: 2, end: 2 }))
      .toEqual({ kind: "revisionPair", base: "c1", target: "c2" });
  });
});

describe("chainedSpan", () => {
  it("holds for one commit and for a run that follows the parents", () => {
    expect(chainedSpan(spine, { start: 0, end: 2 })).toBe(true);
    expect(chainedSpan(merged, { start: 1, end: 1 })).toBe(true);
  });

  it("fails for a run that crosses a break", () => {
    expect(chainedSpan(merged, { start: 0, end: 1 })).toBe(false);
    expect(chainedSpan(merged, { start: 1, end: 2 })).toBe(false);
  });
});

describe("spanOf", () => {
  it("reads a span back out of the request it produced", () => {
    for (const span of [{ start: 0, end: 0 }, { start: 1, end: 2 }, { start: 0, end: 2 }]) {
      expect(spanOf(spine, requestForSpan(spine, span))).toEqual(span);
    }
  });

  it("reads the working-tree entry and a run ending at it back out", () => {
    for (const span of [{ start: 2, end: 2 }, { start: 1, end: 2 }]) {
      expect(spanOf(withWorkingTree, requestForSpan(withWorkingTree, span))).toEqual(span);
    }
    expect(spanOf(withWorkingTree, requestForSpan(withWorkingTree, { start: 0, end: 2 }))).toBeNull();
  });

  it("does not claim the whole range, which the list may not cover", () => {
    expect(spanOf(spine, spine.range)).toBeNull();
  });

  it("does not claim a run that crosses a break, which spans more than it lists", () => {
    expect(spanOf(merged, { kind: "revisionPair", base: "base0", target: "m1" })).toBeNull();
  });

  it("does not claim a comparison outside the spine", () => {
    expect(spanOf(spine, { kind: "revisionPair", base: "elsewhere", target: "c2" })).toBeNull();
    expect(spanOf(spine, { kind: "revisionPair", base: "c1", target: "elsewhere" })).toBeNull();
    expect(spanOf(spine, { kind: "workingTree" })).toBeNull();
  });
});

describe("spansRequest", () => {
  it("holds the spine for the range and for every span of it", () => {
    expect(spansRequest(spine, spine.range)).toBe(true);
    expect(spansRequest(spine, requestForSpan(spine, { start: 1, end: 1 }))).toBe(true);
  });

  it("drops the spine for a comparison it does not span", () => {
    expect(spansRequest(spine, { kind: "revisionPair", base: "other", target: "elsewhere" })).toBe(false);
  });
});

describe("slideSpan", () => {
  it("keeps the width of the span it moves", () => {
    expect(slideSpan(spine, { start: 0, end: 1 }, 1)).toEqual({ start: 1, end: 2 });
  });

  it("steps one commit when the span is one commit", () => {
    expect(slideSpan(spine, { start: 0, end: 0 }, 1)).toEqual({ start: 1, end: 1 });
  });

  it("refuses to slide off either end", () => {
    expect(slideSpan(spine, { start: 0, end: 0 }, -1)).toBeNull();
    expect(slideSpan(spine, { start: 2, end: 2 }, 1)).toBeNull();
    expect(slideSpan(spine, { start: 1, end: 2 }, 1)).toBeNull();
  });

  it("steps a single commit over a break and will not take a window over one", () => {
    expect(slideSpan(merged, { start: 0, end: 0 }, 1)).toEqual({ start: 1, end: 1 });
    expect(slideSpan(merged, { start: 0, end: 1 }, 1)).toBeNull();
  });
});

describe("spanBetween", () => {
  it("reads the same run whichever end was reached first", () => {
    expect(spanBetween(spine, 2, 0)).toEqual({ start: 0, end: 2 });
    expect(spanBetween(spine, 0, 2)).toEqual({ start: 0, end: 2 });
  });

  it("stops at the first break, in either direction", () => {
    expect(spanBetween(merged, 0, 2)).toEqual({ start: 0, end: 0 });
    expect(spanBetween(merged, 2, 0)).toEqual({ start: 2, end: 2 });
  });
});

describe("sameComparisonRequest", () => {
  it("separates the two ways a pair of revisions is compared", () => {
    const pair = { kind: "revisionPair", base: "a", target: "b" } as const;
    expect(sameComparisonRequest(pair, { ...pair })).toBe(true);
    expect(sameComparisonRequest(pair, { kind: "mergeBase", base: "a", target: "b" })).toBe(false);
    expect(sameComparisonRequest({ kind: "workingTree" }, { kind: "workingTree" })).toBe(true);
  });
});

describe("the band's unit", () => {
  it("states each commit in the measure the page is counting in", () => {
    expect(sidesOf(spine.commits[1]!, "lines")).toEqual({ added: 4, removed: 6 });
    expect(sidesOf(spine.commits[1]!, "tokens")).toEqual({ added: 16, removed: 24 });
  });

  it("draws every bar against the heaviest churn in the band", () => {
    expect(heaviestChurn(spine, "lines")).toBe(10);
    expect(heaviestChurn(spine, "tokens")).toBe(40);
  });
});
