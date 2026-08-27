import { describe, expect, it } from "vitest";
import { alignedLines, diffLines, MAX_DIFF_REGION_LINES } from "../src/scanner/linediff.ts";

/** Longest common subsequence length, the size a minimal alignment must keep. */
function longestCommonSubsequence(left: readonly string[], right: readonly string[]): number {
  const table = Array.from({ length: left.length + 1 }, () => new Int32Array(right.length + 1));
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      table[row]![column] = left[row - 1] === right[column - 1]
        ? table[row - 1]![column - 1]! + 1
        : Math.max(table[row - 1]![column]!, table[row]![column - 1]!);
    }
  }
  return table[left.length]![right.length]!;
}

/** A deterministic generator, because a flaky corpus is worse than a small one. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe("line diff", () => {
  it("keeps the whole common subsequence, so no shared line reads as churn", () => {
    const random = makeRandom(20260826);
    for (let trial = 0; trial < 2000; trial += 1) {
      const alphabet = 1 + Math.floor(random() * 4);
      const line = (): string => String.fromCharCode(97 + Math.floor(random() * alphabet));
      const before = Array.from({ length: Math.floor(random() * 12) }, line);
      const after = Array.from({ length: Math.floor(random() * 12) }, line);

      const alignment = diffLines(before, after);
      const keptBefore = before.length - alignment.removed.length;
      const keptAfter = after.length - alignment.added.length;
      const expected = longestCommonSubsequence(before, after);

      expect({ keptBefore, keptAfter }).toEqual({ keptBefore: expected, keptAfter: expected });

      // The kept lines must pair up in order, or the alignment is not one.
      const removed = new Set(alignment.removed);
      const added = new Set(alignment.added);
      expect(before.filter((_, index) => !removed.has(index)).join(""))
        .toBe(after.filter((_, index) => !added.has(index)).join(""));
    }
  });

  it("reports nothing for identical content", () => {
    const lines = ["alpha", "beta", "gamma"];
    expect(diffLines(lines, lines)).toEqual({ added: [], removed: [], capped: false });
  });

  it("reports a whole file for an addition and for a deletion", () => {
    const lines = ["alpha", "beta"];
    expect(diffLines([], lines)).toEqual({ added: [0, 1], removed: [], capped: false });
    expect(diffLines(lines, [])).toEqual({ added: [], removed: [0, 1], capped: false });
  });

  it("indexes each side against its own array, so a shifted line is found on both", () => {
    const before = ["one", "two", "three"];
    const after = ["zero", "one", "two", "THREE"];
    const alignment = diffLines(before, after);
    expect(alignment.removed).toEqual([2]);
    expect(alignment.added).toEqual([0, 3]);
  });

  it("caps only the differing region, so a long file with a small edit is still aligned", () => {
    const before = Array.from({ length: MAX_DIFF_REGION_LINES * 2 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[MAX_DIFF_REGION_LINES] = "changed";

    const alignment = diffLines(before, after);
    expect(alignment.capped).toBe(false);
    expect(alignment.added).toEqual([MAX_DIFF_REGION_LINES]);
    expect(alignment.removed).toEqual([MAX_DIFF_REGION_LINES]);
  });

  it("counts a file that changed everywhere as fully replaced rather than aligning it", () => {
    const size = MAX_DIFF_REGION_LINES;
    const before = Array.from({ length: size }, (_, index) => `before ${index}`);
    const after = Array.from({ length: size }, (_, index) => `after ${index}`);

    const alignment = diffLines(before, after);
    expect(alignment.capped).toBe(true);
    expect(alignment.added).toHaveLength(size);
    expect(alignment.removed).toHaveLength(size);
  });
});

describe("line alignment for the preview", () => {
  it("reads back as both sides, over a random corpus", () => {
    const random = makeRandom(4242);
    for (let trial = 0; trial < 400; trial += 1) {
      const alphabet = 2 + Math.floor(random() * 6);
      const line = (): string => `line ${Math.floor(random() * alphabet)}`;
      const before = Array.from({ length: Math.floor(random() * 40) }, line);
      const after = Array.from({ length: Math.floor(random() * 40) }, line);

      const aligned = alignedLines(before, after, diffLines(before, after));
      expect(aligned.filter((entry) => entry.marker !== "+").map((entry) => entry.text)).toEqual(before);
      expect(aligned.filter((entry) => entry.marker !== "-").map((entry) => entry.text)).toEqual(after);

      // Each gutter counts its own side from one, in order and without a gap.
      const numbers = (side: "beforeLine" | "afterLine"): number[] =>
        aligned.map((entry) => entry[side]).filter((number): number is number => number !== null);
      expect(numbers("beforeLine")).toEqual(before.map((_, index) => index + 1));
      expect(numbers("afterLine")).toEqual(after.map((_, index) => index + 1));
    }
  });

  it("holds the whole file, unchanged lines included", () => {
    const before = ["alpha", "beta", "gamma"];
    const after = ["alpha", "BETA", "gamma"];
    expect(alignedLines(before, after, diffLines(before, after))).toEqual([
      { marker: " ", text: "alpha", beforeLine: 1, afterLine: 1 },
      { marker: "-", text: "beta", beforeLine: 2, afterLine: null },
      { marker: "+", text: "BETA", beforeLine: null, afterLine: 2 },
      { marker: " ", text: "gamma", beforeLine: 3, afterLine: 3 },
    ]);
  });

  it("prints a removal before the addition that replaces it", () => {
    const aligned = alignedLines(["one"], ["two"], diffLines(["one"], ["two"]));
    expect(aligned.map((entry) => entry.marker)).toEqual(["-", "+"]);
  });

  it("marks nothing when the two sides are the same", () => {
    const lines = ["alpha", "beta"];
    const aligned = alignedLines(lines, lines, diffLines(lines, lines));
    expect(aligned.every((entry) => entry.marker === " ")).toBe(true);
  });
});
