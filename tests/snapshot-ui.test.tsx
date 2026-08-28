import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScanMeta } from "../src/shared/api.ts";
import { InstrumentBar } from "../src/web/components/InstrumentBar.tsx";

const META: ScanMeta = {
  rootPath: "project",
  rootName: "project",
  tokenizer: "o200k_base",
  fileCount: 2,
  folderCount: 2,
  scannedAt: "2026-08-28T12:00:00.000Z",
  durationMs: 20,
  fileSource: "git-diff",
  diff: {
    spec: "main...HEAD",
    request: { kind: "mergeBase", base: "main", target: "HEAD" },
    base: "main",
    target: "HEAD",
    filesAdded: 1,
    filesModified: 1,
    filesDeleted: 0,
    filesRenamed: 0,
    cappedFiles: 0,
  },
  skippedLargeFiles: 0,
  languages: ["typescript"],
};

describe("a static instrument bar", () => {
  it("states the frozen comparison without offering host operations", () => {
    const html = renderToStaticMarkup(
      <InstrumentBar
        meta={META}
        staticSnapshot
        backlink={{ label: "PR #12", url: "https://github.com/owner/repo/pull/12" }}
        rescanning={false}
        scanning={false}
        onRescan={() => undefined}
        onOpen={() => undefined}
        onCompare={() => undefined}
        agents={[]}
        agentId=""
        onChooseAgent={() => undefined}
        onAsk={() => undefined}
      />,
    );

    expect(html).toContain("Static snapshot");
    expect(html).toContain('src="./hero.jpg"');
    expect(html).toContain('href="https://github.com/owner/repo/pull/12"');
    expect(html).toContain("PR #12");
    expect(html).toContain("main");
    expect(html).toContain("HEAD");
    expect(html).not.toContain("Recompare");
    expect(html).not.toContain("scan-root");
  });

  it("keeps the live mark rooted when the SPA shell serves a nested route", () => {
    const html = renderToStaticMarkup(
      <InstrumentBar
        meta={META}
        rescanning={false}
        scanning={false}
        onRescan={() => undefined}
        onOpen={() => undefined}
        onCompare={() => undefined}
        agents={[]}
        agentId=""
        onChooseAgent={() => undefined}
        onAsk={() => undefined}
      />,
    );

    expect(html).toContain('src="/hero.jpg"');
  });
});
