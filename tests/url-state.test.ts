import { describe, expect, it } from "vitest";
import { readRequest, writeRequest } from "../src/web/urlState.ts";
import type { ViewPreferences } from "../src/web/preferences.ts";

describe("source-tree sort URL state", () => {
  it("round-trips token sorting while leaving name sorting as the clean default", () => {
    const byTokens = readRequest("?tree=tokens");
    expect(byTokens.treeSort).toBe("tokens");
    expect(writeRequest(byTokens)).toContain("tree=tokens");

    const byName = readRequest("?tree=unknown");
    expect(byName.treeSort).toBe("name");
    expect(writeRequest(byName)).not.toContain("tree=");
  });

  it("uses saved preferences unless the URL embeds its own complete preference state", () => {
    const saved: ViewPreferences = { kinds: ["code", "test"], showGenerated: true, treeSort: "tokens" };
    const inherited = readRequest("?path=src", saved);
    expect(inherited).toMatchObject(saved);

    const shared = readRequest("?prefs=1&kinds=text&path=src", saved);
    expect(shared.kinds).toEqual(["text"]);
    expect(shared.showGenerated).toBe(false);
    expect(shared.treeSort).toBe("name");
  });

  it("marks non-default preferences as complete when serialising a shared URL", () => {
    const request = readRequest("?tree=tokens&kinds=code&gen=1");
    const written = writeRequest(request);
    expect(written).toContain("prefs=1");
    expect(readRequest(`?${written}`, { kinds: ["text"], showGenerated: false, treeSort: "name" }))
      .toMatchObject({ kinds: ["code"], showGenerated: true, treeSort: "tokens" });
  });
});

describe("drill scope URL state", () => {
  it("round-trips the scope independently of ordinary folder selection", () => {
    const request = readRequest("?drill=src%2Fweb&path=src%2Fweb%2Fcomponents");
    expect(request.drillPath).toBe("src/web");
    expect(request.selected.path).toBe("src/web/components");

    const written = writeRequest(request);
    expect(written).toContain("drill=src%2Fweb");
    expect(written).toContain("path=src%2Fweb%2Fcomponents");
  });
});
