import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UNCHANGED_FILE_FIELDS } from "../src/scanner/scan.ts";
import type { FileRow } from "../src/shared/api.ts";
import { FileTable } from "../src/web/components/FileTable.tsx";

function row(overrides: Partial<FileRow>): FileRow {
  return {
    ...UNCHANGED_FILE_FIELDS,
    path: "src/example.ts",
    name: "example.ts",
    kind: "code",
    generated: false,
    status: "modified",
    previousPath: null,
    tokens: 110,
    lines: 11,
    codeLines: 11,
    commentLines: 0,
    blankLines: 0,
    beforeTokens: 100,
    beforeLines: 10,
    beforeCodeLines: 10,
    addedTokens: 20,
    removedTokens: 10,
    churnTokens: 30,
    netTokens: 10,
    functions: 1,
    classes: 0,
    branches: 0,
    language: "typescript",
    ...overrides,
  };
}

function render(files: readonly FileRow[]): string {
  return renderToStaticMarkup(
    <FileTable
      files={files}
      measure="tokens"
      aspect="net"
      isDiff
      sort="net"
      onSortChange={() => undefined}
      displayRoot=""
      onOpenSource={() => undefined}
      onOpenListed={() => undefined}
      emptyMessage="No files"
    />,
  );
}

describe("diff file table percentages", () => {
  it("states per-file churn and signed net against that file's before image", () => {
    const html = render([row({})]);
    expect(html).toContain(">30</td><td class=\"metrics__change-percent\">(30.0%)</td>");
    expect(html).toContain(">+10</td><td class=\"metrics__change-percent\">(+10.0%)</td>");
    expect(html.match(/colSpan=\"2\"/g)).toHaveLength(2);
  });

  it("names a file with no before image as new", () => {
    const html = render([row({ beforeTokens: 0, tokens: 20, addedTokens: 20, removedTokens: 0, churnTokens: 20, netTokens: 20 })]);
    expect(html).toContain(">20</td><td class=\"metrics__change-percent\">(new)</td>");
    expect(html).toContain(">+20</td><td class=\"metrics__change-percent\">(new)</td>");
  });
});
