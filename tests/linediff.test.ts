import { describe, expect, it } from "vitest";
import { diffLines, MAX_DIFF_REGION_LINES, renderUnifiedDiff } from "../src/scanner/linediff.ts";

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

/** Replay a unified diff onto the before-image, the way `patch` would. */
function applyUnifiedDiff(before: readonly string[], patch: string): string[] {
  const result: string[] = [];
  let cursor = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line === "") continue;
    if (line.startsWith("@@")) {
      const start = Number(/^@@ -(\d+)/.exec(line)![1]);
      // Hunk starts are one-based, and a pure insertion at the top reports 0.
      while (cursor < start - 1) result.push(before[cursor++]!);
      continue;
    }
    if (line.startsWith("+")) result.push(line.slice(1));
    else if (line.startsWith("-")) cursor += 1;
    else { result.push(before[cursor]!); cursor += 1; }
  }
  while (cursor < before.length) result.push(before[cursor++]!);
  return result;
}

describe("unified diff rendering", () => {
  it("reconstructs the after-image exactly, over a random corpus", () => {
    const random = makeRandom(4242);
    for (let trial = 0; trial < 400; trial += 1) {
      const alphabet = 2 + Math.floor(random() * 6);
      const line = (): string => `line ${Math.floor(random() * alphabet)}`;
      const before = Array.from({ length: Math.floor(random() * 40) }, line);
      const after = Array.from({ length: Math.floor(random() * 40) }, line);

      const patch = renderUnifiedDiff(before, after, diffLines(before, after), "a.ts", "b.ts");
      const rebuilt = patch === "" ? [...before] : applyUnifiedDiff(before, patch);
      expect(rebuilt).toEqual(after);
    }
  });

  it("renders nothing at all when the two sides are the same", () => {
    const lines = ["alpha", "beta"];
    expect(renderUnifiedDiff(lines, lines, diffLines(lines, lines), "a.ts", "b.ts")).toBe("");
  });

  it("names the missing side /dev/null, so an added and a deleted file read correctly", () => {
    const lines = ["alpha", "beta"];
    const added = renderUnifiedDiff([], lines, diffLines([], lines), "a.ts", "b.ts");
    expect(added.split("\n").slice(0, 3)).toEqual(["--- /dev/null", "+++ b/b.ts", "@@ -0,0 +1,2 @@"]);

    const deleted = renderUnifiedDiff(lines, [], diffLines(lines, []), "a.ts", "b.ts");
    expect(deleted.split("\n").slice(0, 3)).toEqual(["--- a/a.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@"]);
  });

  it("merges two nearby edits into one passage rather than two hunks", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[5] = "changed five";
    after[8] = "changed eight";
    const patch = renderUnifiedDiff(before, after, diffLines(before, after), "a.ts", "b.ts");
    expect(patch.split("\n").filter((line) => line.startsWith("@@"))).toHaveLength(1);
  });
});
