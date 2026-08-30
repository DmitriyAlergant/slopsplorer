import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseViewRequest } from "../src/server/aggregate.ts";
import { FilterBar } from "../src/web/components/FilterBar.tsx";

const request = parseViewRequest({ drillPath: "src" });

describe("the control row", () => {
  it("ends with the two acts on the drilled folder", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        request={request}
        isDiff={false}
        onQueryChange={() => undefined}
        onMeasureChange={() => undefined}
        onAspectChange={() => undefined}
        actionTarget="project/src"
        openInOptions={[{ id: "vscode", label: "VS Code" }]}
        openInApplication="vscode"
        openingIn={null}
        onOpenIn={() => undefined}
        agents={[{ id: "codex", label: "Codex", signedIn: true }]}
        agentId="codex"
        onChooseAgent={() => undefined}
        onAsk={() => undefined}
      />,
    );

    expect(html).toContain("Open in");
    expect(html).toContain("Open project/src in VS Code");
    expect(html).toContain("Ask with Codex");
    expect(html.indexOf("Tokens")).toBeLessThan(html.indexOf("Open in"));
  });

  it("draws no act the host cannot offer", () => {
    const html = renderToStaticMarkup(
      <FilterBar
        request={request}
        isDiff={false}
        onQueryChange={() => undefined}
        onMeasureChange={() => undefined}
        onAspectChange={() => undefined}
        actionTarget={null}
        openInOptions={[]}
        openInApplication="cursor"
        openingIn={null}
        onOpenIn={() => undefined}
        agents={[]}
        agentId=""
        onChooseAgent={() => undefined}
        onAsk={() => undefined}
      />,
    );

    expect(html).toContain("Filter by path");
    expect(html).not.toContain("Open in");
    expect(html).not.toContain("Ask");
  });
});
