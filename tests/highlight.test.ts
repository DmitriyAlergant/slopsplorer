import { describe, expect, it } from "vitest";
import { highlightToLines } from "../src/web/highlight.ts";

/** The text a browser would show for one highlighted line. */
function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"").replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

describe("highlighting cut into lines", () => {
  it("returns one line for one line of source, and loses no text", () => {
    const source = ["const x = 1;", "", "function f<T>(value: T & string) { return value; }"];
    const lines = highlightToLines("sample.ts", source.join("\n"));
    expect(lines).toHaveLength(source.length);
    expect(lines.map(plainText)).toEqual(source);
  });

  it("reopens a span that crosses a line break, so a block comment stays a comment", () => {
    const lines = highlightToLines("sample.ts", "/*\n * middle\n */\nconst after = 1;");
    expect(lines.slice(0, 3).every((line) => line.includes("hljs-comment"))).toBe(true);
    expect(lines.slice(0, 3).every((line) => line.endsWith("</span>"))).toBe(true);
    expect(lines[3]).not.toContain("hljs-comment");
  });

  it("balances the tags of every line", () => {
    const lines = highlightToLines("sample.ts", "const template = `a\nb ${1 + 1} c\nd`;\nconst plain = 2;");
    for (const line of lines) {
      expect((line.match(/<span/g) ?? []).length).toBe((line.match(/<\/span>/g) ?? []).length);
    }
  });

  it("falls back to plain text for a language it does not know", () => {
    const lines = highlightToLines("notes.unknownext", "alpha <b> & 'c'\nbeta");
    expect(lines).toEqual(["alpha &lt;b&gt; &amp; &#x27;c&#x27;", "beta"]);
    expect(lines.map(plainText)).toEqual(["alpha <b> & 'c'", "beta"]);
  });
});
