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
