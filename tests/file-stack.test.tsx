import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FileRow } from "../src/shared/api.ts";
import { parseViewRequest } from "../src/server/aggregate.ts";
import { FileStack, alignNextFileAfterCollapse, foldedAfterFoldAll, inPathOrder } from "../src/web/components/FileStack.tsx";
import { SourceDialog } from "../src/web/components/SourceDialog.tsx";

function row(path: string, figures: Partial<FileRow> = {}): FileRow {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    kind: "code",
    generated: false,
    status: "modified",
    previousPath: null,
    tokens: 100, lines: 40, codeLines: 30, commentLines: 10, blankLines: 4,
    beforeTokens: 100, beforeLines: 40, beforeCodeLines: 30,
    addedTokens: 0, removedTokens: 0, churnTokens: 0, netTokens: 0,
    addedLines: 0, removedLines: 0, churnLines: 0, netLines: 0,
    addedCodeLines: 0, removedCodeLines: 0, churnCodeLines: 0, netCodeLines: 0,
    addedCommentLines: 0, removedCommentLines: 0,
    addedPhysicalLines: 0, removedPhysicalLines: 0,
    functions: 2, classes: 0, branches: 3,
    beforeFunctions: 2, beforeClasses: 0, beforeBranches: 3,
    language: "typescript",
    ...figures,
  };
}

/** The order the panel hands the stack: heaviest first, which the stack ignores. */
const RANKED: FileRow[] = [
  row("src/web/App.tsx", { tokens: 900 }),
  row("src/cli.ts", { tokens: 400 }),
  row("src/web/api.ts", { tokens: 120 }),
];

const NONE_FOLDED: ReadonlySet<string> = new Set();
const loadSource = (): Promise<never> => new Promise(() => undefined);
const loadFileList = async () => ({ rows: RANKED });
const request = parseViewRequest({ kinds: ["code"] });

describe("reading a whole selection", () => {
  it("moves the next file header to the collapsed header's viewport position", () => {
    const scroll = { scrollTop: 420 };
    const nextHeader = { getBoundingClientRect: () => ({ top: 608 }) };

    alignNextFileAfterCollapse(scroll, 560, nextHeader);

    expect(scroll.scrollTop).toBe(468);
  });

  it("orders the files by path whatever order they were ranked in", () => {
    expect(inPathOrder(RANKED).map((file) => file.path)).toEqual([
      "src/cli.ts", "src/web/api.ts", "src/web/App.tsx",
    ]);
  });

  it("leaves the ranked list the panel is drawing untouched", () => {
    inPathOrder(RANKED);
    expect(RANKED.map((file) => file.path)).toEqual([
      "src/web/App.tsx", "src/cli.ts", "src/web/api.ts",
    ]);
  });

  it("draws one section for each file, in path order, none of them read yet", () => {
    const html = renderToStaticMarkup(
      <FileStack rows={RANKED} measure="tokens" isDiff={false} changedOnly={false} loadSource={loadSource} folded={NONE_FOLDED} onToggleFile={() => undefined} />,
    );
    const paths = [...html.matchAll(/stack__file" aria-label="([^"]+)"/g)].map((match) => match[1]);
    expect(paths).toEqual(["src/cli.ts", "src/web/api.ts", "src/web/App.tsx"]);
    expect(html.match(/data-pending="true"/g)).toHaveLength(3);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
    expect(html).toContain("Loading source");
  });

  it("states each file's own figure in the measure the page was in", () => {
    const html = renderToStaticMarkup(
      <FileStack rows={RANKED} measure="tokens" isDiff={false} changedOnly={false} loadSource={loadSource} folded={NONE_FOLDED} onToggleFile={() => undefined} />,
    );
    expect(html).toContain("900");
    expect(html).toContain("tok");
  });

  it("draws a folded file as a closed section with no body to load", () => {
    const html = renderToStaticMarkup(
      <FileStack
        rows={RANKED}
        measure="tokens"
        isDiff={false}
        changedOnly={false}
        loadSource={loadSource}
        folded={new Set(["src/cli.ts"])}
        onToggleFile={() => undefined}
      />,
    );
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(html.match(/data-pending="true"/g)).toHaveLength(2);
  });

  it("folds every file when none is folded, and unfolds every file otherwise", () => {
    expect([...foldedAfterFoldAll(RANKED, new Set())])
      .toEqual(["src/web/App.tsx", "src/cli.ts", "src/web/api.ts"]);
    expect([...foldedAfterFoldAll(RANKED, new Set(["src/cli.ts"]))]).toEqual([]);
    expect([...foldedAfterFoldAll(RANKED, new Set(RANKED.map((file) => file.path)))]).toEqual([]);
  });

  it("states both sides of a compared file beside its Git letter", () => {
    const changed = [row("src/cli.ts", { addedTokens: 12, removedTokens: 5, status: "renamed", previousPath: "old.ts" })];
    const html = renderToStaticMarkup(
      <FileStack rows={changed} measure="tokens" isDiff changedOnly loadSource={loadSource} folded={NONE_FOLDED} onToggleFile={() => undefined} />,
    );
    expect(html).toContain("+12");
    expect(html).toContain("-5");
    expect(html).toContain("Renamed from old.ts");
  });
});

describe("the preview dialog of a whole selection", () => {
  it("counts the files it holds and says they are in path order", () => {
    const html = renderToStaticMarkup(
      <SourceDialog
        preview={{ kind: "files", title: "src/web", request, total: 3, measure: "tokens", isDiff: false }}
        onClose={() => undefined}
        loadSource={loadSource}
        loadFileList={loadFileList}
      />,
    );
    expect(html).toContain("3 files, in path order");
    expect(html).toContain("src/web");
    expect(html).not.toContain("Only changed lines");
  });

  it("states the complete match count before the modal loads its own list", () => {
    const html = renderToStaticMarkup(
      <SourceDialog
        preview={{ kind: "files", title: "src", request, total: 348, measure: "tokens", isDiff: true }}
        onClose={() => undefined}
        loadSource={loadSource}
        loadFileList={loadFileList}
      />,
    );
    expect(html).toContain("348 files, in path order");
    expect(html).toContain("Only changed lines");
  });
});
