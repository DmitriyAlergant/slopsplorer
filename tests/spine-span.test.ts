import { describe, expect, it } from "vitest";
import type { CommitSpine, SpineEntry } from "../src/shared/api.ts";
import {
  requestForSpan, sameComparisonRequest, slideSpan, spanBetween, spanOf, spansRequest,
} from "../src/shared/api.ts";
import { heaviestChurn, sidesOf } from "../src/web/spine.ts";

function entry(sha: string, added: number, removed: number): SpineEntry {
  return {
    sha,
    shortSha: sha.slice(0, 7),
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

const spine: CommitSpine = {
  range: { kind: "revisionPair", base: "base0", target: "head" },
  base: "base0",
  commits: [entry("c1", 10, 0), entry("c2", 4, 6), entry("c3", 1, 1)],
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
});

describe("spanOf", () => {
  it("reads a span back out of the request it produced", () => {
    for (const span of [{ start: 0, end: 0 }, { start: 1, end: 2 }, { start: 0, end: 2 }]) {
      expect(spanOf(spine, requestForSpan(spine, span))).toEqual(span);
    }
  });

  it("does not claim the whole range, which the list may not cover", () => {
    expect(spanOf(spine, spine.range)).toBeNull();
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
});

describe("spanBetween", () => {
  it("reads the same run whichever end was reached first", () => {
    expect(spanBetween(2, 0)).toEqual({ start: 0, end: 2 });
    expect(spanBetween(0, 2)).toEqual({ start: 0, end: 2 });
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
