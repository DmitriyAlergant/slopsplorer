import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/web/markdown.tsx";

/** The markup the dialog would hold for one answer. */
function draw(markdown: string): string {
  return renderToStaticMarkup(<>{renderMarkdown(markdown)}</>);
}

describe("drawing an agent answer", () => {
  it("draws the ordinary blocks of Markdown", () => {
    const html = draw("# Heading\n\nA point about `code`, in **bold**.\n\n- first\n- second\n");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<code class="answer__code">code</code>');
    expect(html).toContain("<li>");
    expect(html).toContain("first");
  });

  it("highlights a fenced block in the language on the fence", () => {
    const html = draw("```ts\nconst answer = 1;\n```\n");
    expect(html).toContain('class="answer__pre"');
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("answer");
  });

  it("draws a fence in a language nothing knows as plain text", () => {
    const html = draw("```unknownlang\na < b\n```\n");
    expect(html).toContain("a &lt; b");
    expect(html).not.toContain("<b>");
  });

  it("draws a table with the alignment the divider row asked for", () => {
    const html = draw("| left | right |\n| :--- | ----: |\n| 1 | 2 |\n");
    expect(html).toContain('class="answer__table"');
    expect(html).toContain("text-align:right");
    expect(html).toContain("<td");
  });

  it("never lets the answer become markup", () => {
    const html = draw("Beware <img src=x onerror=alert(1)> and <script>alert(2)</script>.\n");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps an http link and refuses a script one", () => {
    const safe = draw("[docs](https://example.com/guide)");
    expect(safe).toContain('href="https://example.com/guide"');
    expect(safe).toContain('rel="noreferrer"');

    const unsafe = draw("[tap here](javascript:alert(1))");
    expect(unsafe).not.toContain("href");
    expect(unsafe).toContain("tap here");
  });

  it("keeps a relative link, which can only point back at this page", () => {
    expect(draw("[a file](src/web/App.tsx)")).toContain('href="src/web/App.tsx"');
  });

  it("draws a task list as its boxes", () => {
    const html = draw("- [x] done\n- [ ] not done\n");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("not done");
  });
});
