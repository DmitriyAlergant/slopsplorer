import { describe, expect, it } from "vitest";
import { readRequest, writeRequest } from "../src/web/urlState.ts";
import type { ViewPreferences } from "../src/web/preferences.ts";

describe("source-tree sort URL state", () => {
  it("round-trips weight sorting while leaving name sorting as the clean default", () => {
    const byWeight = readRequest("?tree=weight");
    expect(byWeight.treeSort).toBe("weight");
    expect(writeRequest(byWeight)).toContain("tree=weight");

    const byName = readRequest("?tree=unknown");
    expect(byName.treeSort).toBe("name");
    expect(writeRequest(byName)).not.toContain("tree=");
  });

  it("uses saved preferences unless the URL embeds its own complete preference state", () => {
    const saved: ViewPreferences = {
      kinds: ["code", "test"], showGenerated: true, treeSort: "weight", measure: "codeLines",
      rankMetric: "commentLines",
    };
    const inherited = readRequest("?path=src", saved);
    expect(inherited).toMatchObject({
      kinds: saved.kinds, showGenerated: true, treeSort: "weight", measure: "codeLines",
    });
    expect(inherited.rank.metric).toBe("commentLines");

    const shared = readRequest("?prefs=1&kinds=text&path=src", saved);
    expect(shared.kinds).toEqual(["text"]);
    expect(shared.showGenerated).toBe(false);
    expect(shared.treeSort).toBe("name");
    expect(shared.measure).toBe("tokens");
    expect(shared.rank.metric).toBe("tokens");
  });

  it("marks non-default preferences as complete when serialising a shared URL", () => {
    const request = readRequest("?tree=weight&kinds=code&gen=1");
    const written = writeRequest(request);
    expect(written).toContain("prefs=1");
    const stored: ViewPreferences = {
      kinds: ["text"], showGenerated: false, treeSort: "name", measure: "tokens", rankMetric: "tokens",
    };
    expect(readRequest(`?${written}`, stored))
      .toMatchObject({ kinds: ["code"], showGenerated: true, treeSort: "weight" });
  });
});

describe("primary measure URL state", () => {
  it("round-trips a chosen measure and omits the tokens default", () => {
    const byCodeLines = readRequest("?measure=codeLines");
    expect(byCodeLines.measure).toBe("codeLines");
    const written = writeRequest(byCodeLines);
    expect(written).toContain("measure=codeLines");
    expect(written).toContain("prefs=1");

    const defaulted = readRequest("?measure=furlongs");
    expect(defaulted.measure).toBe("tokens");
    expect(writeRequest(defaulted)).not.toContain("measure=");
  });

  it("marks a sorted column outside the defaults as a complete preference state", () => {
    const request = readRequest("?rank=functions");
    expect(request.rank.metric).toBe("functions");
    const written = writeRequest(request);
    expect(written).toContain("rank=functions");
    expect(written).toContain("prefs=1");

    const defaulted = readRequest("?rank=classes");
    expect(defaulted.rank.metric).toBe("tokens");
    expect(writeRequest(defaulted)).not.toContain("rank=");
  });

  it("carries the ranking threshold in whatever measure is active", () => {
    const request = readRequest("?measure=lines&min=40");
    expect(request.rank.minWeight).toBe(40);
    expect(writeRequest(request)).toContain("min=40");
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

describe("drill scope URL state", () => {
  it("pulls a selection that falls outside the drill scope onto the scope itself", () => {
    const bare = readRequest("?drill=src");
    expect(bare.selected).toEqual({ rowKind: "folder", path: "src" });
    expect(bare.expanded).toEqual(["", "src"]);

    const elsewhere = readRequest("?drill=src&path=tests&sel=files");
    expect(elsewhere.selected).toEqual({ rowKind: "folder", path: "src" });
  });

  it("leaves a selection inside the drill scope alone", () => {
    const inside = readRequest("?drill=src&path=src/web&sel=files");
    expect(inside.selected).toEqual({ rowKind: "files", path: "src/web" });
    expect(inside.expanded).toEqual(["", "src", "src/web"]);
  });
});
