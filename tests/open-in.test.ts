import { describe, expect, it } from "vitest";
import { buildOpenInOptions, buildOpenInPlan } from "../src/server/openIn.ts";

describe("opening the current folder in another application", () => {
  it("names the operating system file manager without probing installed applications", () => {
    expect(buildOpenInOptions("darwin").map(({ id, label }) => [id, label])).toEqual([
      ["cursor", "Cursor"],
      ["vscode", "VS Code"],
      ["fileManager", "Finder"],
    ]);
    expect(buildOpenInOptions("win32")[2]?.label).toBe("File Explorer");
    expect(buildOpenInOptions("linux")[2]?.label).toBe("File manager");
  });

  it("uses application bundles on macOS, so editor shell commands need not be installed", () => {
    expect(buildOpenInPlan("darwin", "cursor", "/repo/src")).toEqual({
      command: "open",
      arguments: ["-a", "Cursor", "/repo/src"],
    });
    expect(buildOpenInPlan("darwin", "vscode", "/repo")).toEqual({
      command: "open",
      arguments: ["-a", "Visual Studio Code", "/repo"],
    });
    expect(buildOpenInPlan("darwin", "fileManager", "/repo/src")).toEqual({
      command: "open",
      arguments: ["/repo/src"],
    });
  });

  it("uses the editor launchers and native file-manager command on Windows and Linux", () => {
    expect(buildOpenInPlan("win32", "cursor", "C:\\repo")).toEqual({
      command: "cursor",
      arguments: ["C:\\repo"],
    });
    expect(buildOpenInPlan("win32", "vscode", "C:\\repo")).toEqual({
      command: "code",
      arguments: ["C:\\repo"],
    });
    expect(buildOpenInPlan("win32", "fileManager", "C:\\repo")).toEqual({
      command: "explorer.exe",
      arguments: ["C:\\repo"],
    });
    expect(buildOpenInPlan("linux", "fileManager", "/repo")).toEqual({
      command: "xdg-open",
      arguments: ["/repo"],
    });
  });
});
