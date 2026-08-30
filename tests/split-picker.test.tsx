import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentPicker } from "../src/web/components/AgentPicker.tsx";
import { OpenInPicker } from "../src/web/components/OpenInPicker.tsx";

function singleLineTooltips(html: string): number {
  return html.match(/data-compact="true" data-single-line="true"/g)?.length ?? 0;
}

describe("split control tooltips", () => {
  it("keeps both Open in hints to one line and gives the chevron a choice label", () => {
    const html = renderToStaticMarkup(
      <OpenInPicker
        options={[
          { id: "cursor", label: "Cursor" },
          { id: "vscode", label: "VS Code" },
          { id: "fileManager", label: "Finder" },
        ]}
        application="vscode"
        targetLabel="project/src"
        opening={null}
        onOpen={() => undefined}
      />,
    );
    expect(singleLineTooltips(html)).toBe(2);
    expect(html).toContain("Open project/src in VS Code");
    expect(html).toContain("Choose application");
  });

  it("keeps both Ask hints to one line and gives the chevron a choice label", () => {
    const html = renderToStaticMarkup(
      <AgentPicker
        agents={[{ id: "codex", label: "Codex", signedIn: true }]}
        agentId="codex"
        onChoose={() => undefined}
        onAsk={() => undefined}
      />,
    );
    expect(singleLineTooltips(html)).toBe(2);
    expect(html).toContain("Ask with Codex");
    expect(html).toContain("Choose agent");
  });
});
