import { describe, expect, it } from "vitest";
import { displayFilePath, pathRelativeTo } from "../src/web/displayPath.ts";

describe("display paths", () => {
  it("shows direct files relative to the selected folder", () => {
    expect(pathRelativeTo(
      "tests/mock/llm_server/mock_llm_server/surfaces/openai.py",
      "tests/mock/llm_server/mock_llm_server/surfaces",
    )).toBe("openai.py");
  });

  it("shows ranked files relative to the drill root", () => {
    expect(pathRelativeTo(
      "tests/mock/llm_server/mock_llm_server/surfaces/openai.py",
      "tests/mock/llm_server/mock_llm_server",
    )).toBe("surfaces/openai.py");
  });

  it("leaves project-relative paths unchanged without a drill root", () => {
    expect(pathRelativeTo("src/web/App.tsx", "")).toBe("src/web/App.tsx");
  });

  it("marks ranked paths as relative to the drill root", () => {
    expect(displayFilePath("src/web/App.tsx", "src", true)).toBe("./web/App.tsx");
  });

  it("keeps folder-level file names concise", () => {
    expect(displayFilePath("src/web/App.tsx", "src/web", false)).toBe("App.tsx");
  });
});
