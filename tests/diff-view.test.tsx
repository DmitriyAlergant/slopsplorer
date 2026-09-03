import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiffLine } from "../src/shared/api.ts";
import { DiffView, linesOfSide } from "../src/web/components/DiffView.tsx";

/** One modified file: two shared lines, one replaced, two shared again. */
const CHANGE: DiffLine[] = [
  { marker: " ", text: "const one = 1;", beforeLine: 1, afterLine: 1 },
  { marker: " ", text: "const two = 2;", beforeLine: 2, afterLine: 2 },
  { marker: "-", text: "const three = 3;", beforeLine: 3, afterLine: null },
  { marker: "+", text: "const three = 33;", beforeLine: null, afterLine: 3 },
  { marker: " ", text: "const four = 4;", beforeLine: 4, afterLine: 4 },
  { marker: " ", text: "const five = 5;", beforeLine: 5, afterLine: 5 },
];

const ADDED_FILE: DiffLine[] = [
  { marker: "+", text: "const only = 1;", beforeLine: null, afterLine: 1 },
];

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** A block of new prose, which an aligner reports with the blank lines shared. */
const STRIPED: DiffLine[] = [
  { marker: " ", text: "# Title", beforeLine: 1, afterLine: 1 },
  { marker: " ", text: "", beforeLine: 2, afterLine: 2 },
  { marker: "+", text: "One new sentence.", beforeLine: null, afterLine: 3 },
  { marker: " ", text: "", beforeLine: 3, afterLine: 4 },
  { marker: "+", text: "Another new sentence.", beforeLine: null, afterLine: 5 },
  { marker: " ", text: "", beforeLine: 4, afterLine: 6 },
  { marker: " ", text: "The old ending.", beforeLine: 5, afterLine: 7 },
];

describe("one side of a compared file", () => {
  it("keeps the lines that side holds and drops the other side's", () => {
    expect(linesOfSide(CHANGE, "before").map((line) => line.text)).toEqual([
      "const one = 1;", "const two = 2;", "const three = 3;", "const four = 4;", "const five = 5;",
    ]);
    expect(linesOfSide(CHANGE, "after").map((line) => line.text)).toEqual([
      "const one = 1;", "const two = 2;", "const three = 33;", "const four = 4;", "const five = 5;",
    ]);
  });

  it("numbers the before image from the before side and draws no marker column", () => {
    const html = renderToStaticMarkup(
      <DiffView path="src/cli.ts" lines={CHANGE} changedOnly={false} side="before" />,
    );
    expect(html).toContain("diff--side");
    expect(html).not.toContain("diff__marker");
    expect(html.match(/diff__line/g)).toHaveLength(5);
    expect(html.match(/diff__number/g)).toHaveLength(5);
    expect(textOf(html)).toContain("const three = 3;");
    expect(textOf(html)).not.toContain("const three = 33;");
  });

  it("numbers the after image from the after side", () => {
    const html = renderToStaticMarkup(
      <DiffView path="src/cli.ts" lines={CHANGE} changedOnly={false} side="after" />,
    );
    expect(textOf(html)).toContain("const three = 33;");
    expect(textOf(html)).not.toContain("const three = 3;<");
  });

  it("draws the file whole, because hiding unchanged lines is a question about a change", () => {
    const html = renderToStaticMarkup(
      <DiffView path="src/cli.ts" lines={CHANGE} changedOnly side="after" />,
    );
    expect(html).not.toContain("diff__gap");
    expect(html.match(/diff__line/g)).toHaveLength(5);
  });

  it("washes the whole side in its own colour and marks no line of it", () => {
    const html = renderToStaticMarkup(
      <DiffView path="src/cli.ts" lines={STRIPED} changedOnly={false} side="after" />,
    );
    expect(html).toContain('data-side="after"');
    expect(html).not.toContain("data-marker");
  });

  it("says which side it draws, so the body carries that side's colour", () => {
    const before = renderToStaticMarkup(
      <DiffView path="src/cli.ts" lines={CHANGE} changedOnly={false} side="before" />,
    );
    expect(before).toContain('data-side="before"');
  });

  it("says so when the side holds nothing, as the before image of a new file does", () => {
    const html = renderToStaticMarkup(
      <DiffView path="src/cli.ts" lines={ADDED_FILE} changedOnly={false} side="before" />,
    );
    expect(textOf(html)).toBe("The before image of this file is empty.");
  });

  it("draws both gutters and the marker when the side is the change itself", () => {
    const html = renderToStaticMarkup(
      <DiffView path="src/cli.ts" lines={CHANGE} changedOnly={false} side="diff" />,
    );
    expect(html).not.toContain("diff--side");
    expect(html.match(/diff__marker/g)).toHaveLength(6);
    expect(html.match(/diff__line/g)).toHaveLength(6);
  });
});
