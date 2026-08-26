import { describe, expect, it } from "vitest";
import { readRequest, writeRequest } from "../src/web/urlState.ts";

describe("source-tree sort URL state", () => {
  it("round-trips token sorting while leaving name sorting as the clean default", () => {
    const byTokens = readRequest("?tree=tokens");
    expect(byTokens.treeSort).toBe("tokens");
    expect(writeRequest(byTokens)).toContain("tree=tokens");

    const byName = readRequest("?tree=unknown");
    expect(byName.treeSort).toBe("name");
    expect(writeRequest(byName)).not.toContain("tree=");
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
