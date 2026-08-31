import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SummaryView } from "../src/shared/api.ts";
import { MassRibbon } from "../src/web/components/MassRibbon.tsx";

const SUMMARY: SummaryView = {
  projectWeight: 40,
  scopePath: "",
  scopeWeight: 40,
  widestWeight: 40,
  selectedWeight: 20,
  selectedAdded: 30,
  selectedRemoved: 10,
  selectedFiles: 2,
  selectedTokens: 120,
  selectedLines: 12,
  selectedCodeLines: 12,
  selectedBeforeTokens: 100,
  selectedBeforeLines: 10,
  selectedBeforeCodeLines: 10,
  selectedChurnTokens: 40,
  selectedChurnLines: 4,
  selectedChurnCodeLines: 4,
  ribbon: [],
};

describe("diff total readouts", () => {
  it("follows the four raw totals with churn and signed net percentages", () => {
    const html = renderToStaticMarkup(
      <MassRibbon
        summary={SUMMARY}
        measure="tokens"
        aspect="net"
        isDiff
        countedFlavors={[]}
        selected={{ rowKind: "folder", path: "" }}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("40.0%<\/span><span class=\"readout__label\">churn %");
    expect(html).toContain("+20.0%<\/span><span class=\"readout__label\">net %");
    expect(html).not.toContain("readout__label\">files");
  });
});
