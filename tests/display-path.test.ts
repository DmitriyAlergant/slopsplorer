import { describe, expect, it } from "vitest";
import { pathRelativeTo } from "../src/web/displayPath.ts";

describe("display paths", () => {
  it("shows direct files relative to the selected folder", () => {
    expect(pathRelativeTo(
      "tests/mock/llm_server/mock_llm_server/surfaces/openai.py",
      "tests/mock/llm_server/mock_llm_server/surfaces",
    )).toBe("openai.py");
  });

  it("shows a file deeper in the subtree relative to the selected folder", () => {
    expect(pathRelativeTo(
      "tests/mock/llm_server/mock_llm_server/surfaces/openai.py",
      "tests/mock/llm_server/mock_llm_server",
    )).toBe("surfaces/openai.py");
  });

  it("leaves project-relative paths unchanged at the scan root", () => {
    expect(pathRelativeTo("src/web/App.tsx", "")).toBe("src/web/App.tsx");
  });
});
