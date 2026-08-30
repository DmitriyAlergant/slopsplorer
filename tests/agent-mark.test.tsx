import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMark } from "../src/web/components/AgentMark.tsx";

describe("agent brand marks", () => {
  it("keeps Claude's brand colour and leaves Cursor on the theme-aware mono colour", () => {
    const claude = renderToStaticMarkup(<AgentMark agentId="claude" />);
    const cursor = renderToStaticMarkup(<AgentMark agentId="cursor" />);
    expect(claude).toContain('data-agent-id="claude"');
    expect(claude).toContain("color:#d97757");
    expect(cursor).toContain('data-agent-id="cursor"');
  });

  it("draws Codex with its Lobe Icons colour gradient", () => {
    const codex = renderToStaticMarkup(<AgentMark agentId="codex" />);
    expect(codex).toContain("#B1A7FF");
    expect(codex).toContain("#7A9DFF");
    expect(codex).toContain("#3941FF");
  });
});
