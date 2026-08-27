/**
 * Which physical lines a change touched, on each side.
 *
 * Indices are into the arrays that were compared, so a caller can read its own
 * per-line verdicts at exactly these positions rather than re-classifying the
 * changed lines out of the context that decided them.
 */
export interface LineDiff {
  /** Indices into the after-image lines the change added. */
  added: number[];
  /** Indices into the before-image lines the change removed. */
  removed: number[];
  /** Whether the size cap made the differing region count as fully replaced. */
  capped: boolean;
}

/**
 * Largest differing region, in lines from both sides together, that gets a
 * real diff.
 *
 * The cap is applied after the common head and tail are trimmed, so a long
 * file with a small edit is never mistaken for a rewrite. What the cap bounds
 * is the file that changed nearly everywhere, where the alignment costs
 * quadratic time and tells the reader nothing a wholesale replacement does not.
 */
export const MAX_DIFF_REGION_LINES = 10_000;

/** Map lines onto integers once, so the inner loops compare numbers. */
function intern(before: readonly string[], after: readonly string[]): { a: Int32Array; b: Int32Array } {
  const ids = new Map<string, number>();
  const idOf = (line: string): number => {
    const existing = ids.get(line);
    if (existing !== undefined) return existing;
    const assigned = ids.size;
    ids.set(line, assigned);
    return assigned;
  };
  return {
    a: Int32Array.from(before, idOf),
    b: Int32Array.from(after, idOf),
  };
}

/** The diagonal run that a minimal edit path is guaranteed to pass through. */
interface Snake {
  xStart: number;
  yStart: number;
  xEnd: number;
  yEnd: number;
}

/**
 * Myers' middle snake, in linear space.
 *
 * A forward search and a reverse search advance one step at a time until they
 * overlap. The diagonal run at the meeting point belongs to some minimal edit
 * script, so the problem splits there and the two halves are solved the same
 * way. Storing only the current frontier is what keeps the memory linear,
 * which matters because a whole repository's worth of files run through here.
 */
function middleSnake(
  a: Int32Array, aLow: number, aHigh: number,
  b: Int32Array, bLow: number, bHigh: number,
  forward: Int32Array, reverse: Int32Array, offset: number,
): Snake {
  const n = aHigh - aLow;
  const m = bHigh - bLow;
  const delta = n - m;
  const deltaIsOdd = (delta & 1) !== 0;
  forward[offset + 1] = 0;
  reverse[offset + 1] = 0;

  for (let d = 0; d <= Math.ceil((n + m) / 2); d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && forward[offset + k - 1]! < forward[offset + k + 1]!)
        ? forward[offset + k + 1]!
        : forward[offset + k - 1]! + 1;
      let y = x - k;
      const xStart = x;
      const yStart = y;
      while (x < n && y < m && a[aLow + x] === b[bLow + y]) { x += 1; y += 1; }
      forward[offset + k] = x;
      // The reverse frontier of the previous step covers exactly these
      // diagonals, and only when delta is odd do the two parities line up.
      if (deltaIsOdd && k >= delta - (d - 1) && k <= delta + (d - 1)) {
        if (x + reverse[offset + delta - k]! >= n) {
          return { xStart: aLow + xStart, yStart: bLow + yStart, xEnd: aLow + x, yEnd: bLow + y };
        }
      }
    }

    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && reverse[offset + k - 1]! < reverse[offset + k + 1]!)
        ? reverse[offset + k + 1]!
        : reverse[offset + k - 1]! + 1;
      let y = x - k;
      const xStart = x;
      const yStart = y;
      while (x < n && y < m && a[aHigh - 1 - x] === b[bHigh - 1 - y]) { x += 1; y += 1; }
      reverse[offset + k] = x;
      if (!deltaIsOdd && k >= delta - d && k <= delta + d) {
        if (x + forward[offset + delta - k]! >= n) {
          // Reverse coordinates count back from the end, so the run reads
          // forward from the further point to the nearer one.
          return {
            xStart: aLow + n - x, yStart: bLow + m - y,
            xEnd: aLow + n - xStart, yEnd: bLow + m - yStart,
          };
        }
      }
    }
  }
  throw new Error("no middle snake: the two line arrays are not comparable");
}

/**
 * Mark every line of one region that a minimal edit script does not match.
 *
 * Both flag arrays arrive with the whole region marked as changed, and this
 * clears the lines that pair up, so a region that is never visited stays fully
 * changed. That is what makes a pure insertion or a pure deletion fall out
 * without a case of its own.
 */
function clearMatches(
  a: Int32Array, aLow: number, aHigh: number,
  b: Int32Array, bLow: number, bHigh: number,
  aChanged: Uint8Array, bChanged: Uint8Array,
  forward: Int32Array, reverse: Int32Array, offset: number,
): void {
  let low = aLow;
  let high = aHigh;
  let bottom = bLow;
  let top = bHigh;
  while (low < high && bottom < top && a[low] === b[bottom]) {
    aChanged[low] = 0;
    bChanged[bottom] = 0;
    low += 1;
    bottom += 1;
  }
  while (low < high && bottom < top && a[high - 1] === b[top - 1]) {
    high -= 1;
    top -= 1;
    aChanged[high] = 0;
    bChanged[top] = 0;
  }
  if (low === high || bottom === top) return;

  const snake = middleSnake(a, low, high, b, bottom, top, forward, reverse, offset);
  clearMatches(a, low, snake.xStart, b, bottom, snake.yStart, aChanged, bChanged, forward, reverse, offset);
  for (let step = 0; step < snake.xEnd - snake.xStart; step += 1) {
    aChanged[snake.xStart + step] = 0;
    bChanged[snake.yStart + step] = 0;
  }
  clearMatches(a, snake.xEnd, high, b, snake.yEnd, top, aChanged, bChanged, forward, reverse, offset);
}

/** Align two line arrays and report which lines each side does not share. */
export function diffLines(before: readonly string[], after: readonly string[]): LineDiff {
  const { a, b } = intern(before, after);
  const aChanged = new Uint8Array(a.length).fill(1);
  const bChanged = new Uint8Array(b.length).fill(1);

  let low = 0;
  let bottom = 0;
  while (low < a.length && bottom < b.length && a[low] === b[bottom]) {
    aChanged[low] = 0;
    bChanged[bottom] = 0;
    low += 1;
    bottom += 1;
  }
  let high = a.length;
  let top = b.length;
  while (low < high && bottom < top && a[high - 1] === b[top - 1]) {
    high -= 1;
    top -= 1;
    aChanged[high] = 0;
    bChanged[top] = 0;
  }

  const capped = (high - low) + (top - bottom) > MAX_DIFF_REGION_LINES;
  if (!capped && low < high && bottom < top) {
    const bound = Math.ceil(((high - low) + (top - bottom)) / 2) + 2;
    const forward = new Int32Array(2 * bound + 2);
    const reverse = new Int32Array(2 * bound + 2);
    clearMatches(a, low, high, b, bottom, top, aChanged, bChanged, forward, reverse, bound);
  }

  const removed: number[] = [];
  const added: number[] = [];
  for (let index = 0; index < aChanged.length; index += 1) if (aChanged[index] === 1) removed.push(index);
  for (let index = 0; index < bChanged.length; index += 1) if (bChanged[index] === 1) added.push(index);
  return { added, removed, capped };
}

/** One printed line of a unified diff, before it is grouped into hunks. */
interface DiffOperation {
  marker: " " | "-" | "+";
  text: string;
  beforeLine: number;
  afterLine: number;
}

/** Lines of unchanged context kept on each side of a change. */
const CONTEXT_LINES = 3;

/**
 * Interleave two line arrays into one printable sequence.
 *
 * A removal is printed before the addition that replaces it, which is the
 * conventional order and the one a reader scans for.
 */
function interleave(before: readonly string[], after: readonly string[], alignment: LineDiff): DiffOperation[] {
  const removed = new Set(alignment.removed);
  const added = new Set(alignment.added);
  const operations: DiffOperation[] = [];
  let beforeCursor = 0;
  let afterCursor = 0;
  while (beforeCursor < before.length || afterCursor < after.length) {
    if (beforeCursor < before.length && removed.has(beforeCursor)) {
      operations.push({ marker: "-", text: before[beforeCursor]!, beforeLine: beforeCursor + 1, afterLine: afterCursor });
      beforeCursor += 1;
      continue;
    }
    if (afterCursor < after.length && added.has(afterCursor)) {
      operations.push({ marker: "+", text: after[afterCursor]!, beforeLine: beforeCursor, afterLine: afterCursor + 1 });
      afterCursor += 1;
      continue;
    }
    operations.push({ marker: " ", text: after[afterCursor]!, beforeLine: beforeCursor + 1, afterLine: afterCursor + 1 });
    beforeCursor += 1;
    afterCursor += 1;
  }
  return operations;
}

/**
 * Render one file's change as a unified diff.
 *
 * Built from the same alignment the file's numbers were summed over, so the
 * preview and the figures beside it can never describe different changes. It
 * also reaches a file Git does not track yet, which `git diff` cannot show and
 * which is most of what uncommitted work is.
 */
export function renderUnifiedDiff(
  before: readonly string[], after: readonly string[], alignment: LineDiff,
  beforePath: string, afterPath: string,
): string {
  const operations = interleave(before, after, alignment);
  const changed = operations.map((operation) => operation.marker !== " ");
  if (!changed.includes(true)) return "";

  const hunks: string[] = [];
  let position = 0;
  while (position < operations.length) {
    if (!changed[position]) {
      position += 1;
      continue;
    }
    const start = Math.max(0, position - CONTEXT_LINES);
    let end = position;
    // Absorb the next change when its own context would touch this hunk's,
    // so two edits a line apart read as one passage rather than two.
    for (let scan = position; scan < operations.length; scan += 1) {
      if (!changed[scan]) continue;
      if (scan - end > CONTEXT_LINES * 2) break;
      end = scan;
    }
    const stop = Math.min(operations.length, end + CONTEXT_LINES + 1);
    const body = operations.slice(start, stop);
    const beforeCount = body.filter((operation) => operation.marker !== "+").length;
    const afterCount = body.filter((operation) => operation.marker !== "-").length;
    const beforeStart = body.find((operation) => operation.marker !== "+")?.beforeLine ?? 0;
    const afterStart = body.find((operation) => operation.marker !== "-")?.afterLine ?? 0;
    hunks.push(`@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`);
    for (const operation of body) hunks.push(`${operation.marker}${operation.text}`);
    position = stop;
  }

  const header = [`--- ${before.length === 0 ? "/dev/null" : `a/${beforePath}`}`, `+++ ${after.length === 0 ? "/dev/null" : `b/${afterPath}`}`];
  return `${[...header, ...hunks].join("\n")}\n`;
}
