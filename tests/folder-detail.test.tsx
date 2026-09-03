import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DetailView, FlavorStat } from "../src/shared/api.ts";
import { FolderDetail } from "../src/web/components/FolderDetail.tsx";

/** Docs that grew in some files and shrank in more of them: a net far below the mass moved. */
const FLAVOR_STATS: FlavorStat[] = [
  { flavor: "code", weight: 1_646, enabled: true },
  { flavor: "text", weight: -107_579, enabled: true },
];

const DETAIL: DetailView = {
  title: "secondgate",
  trail: [],
  weight: -107_579,
  added: 76_333,
  removed: 183_912,
  files: 90,
  tokens: 76_333,
  lines: 0,
  codeLines: 0,
  beforeTokens: 183_912,
  beforeLines: 0,
  beforeCodeLines: 0,
  churnTokens: 260_245,
  churnLines: 0,
  churnCodeLines: 0,
  shareOfScope: 0.8,
  cards: [],
  shownFiles: 90,
  availableFiles: 90,
  flavorStats: FLAVOR_STATS,
  flavorBaseline: 326_117,
  cardColumns: 3,
};

function renderNetPanel(): string {
  return renderToStaticMarkup(
    <FolderDetail
      detail={DETAIL}
      files={[]}
      filesTotal={90}
      filesOffset={0}
      measure="tokens"
      aspect="net"
      widestWeight={326_117}
      isDiff
      sort="name"
      onSortChange={() => undefined}
      path="docs"
      onSelect={() => undefined}
      directFilesOnly={false}
      fileScope="subtree"
      onFileScopeChange={() => undefined}
      onToggleKind={() => undefined}
      onToggleGenerated={() => undefined}
      canDrill
      onDrill={() => undefined}
      rank={{ metric: "name", minWeight: 0, limit: 100, offset: 0 }}
      onRankChange={() => undefined}
      onOpenSource={() => undefined}
      onOpenListed={() => undefined}
      onCapacityChange={() => undefined}
    />,
  );
}

describe("the flavor switches of a comparison", () => {
  it("signs the flavor's net, so it reads with the folder figures above it", () => {
    const html = renderNetPanel();
    expect(html).toContain(">-107,579<");
    expect(html).toContain(">+1,646<");
  });

  it("states the same signed figure in its tooltip", () => {
    const html = renderNetPanel();
    expect(html).toContain("-107,579 net tokens available in this scope.");
  });
});
