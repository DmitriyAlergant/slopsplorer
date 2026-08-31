import { describe, expect, it } from "vitest";
import { snapshotReproductionCommand } from "../src/server/export.ts";

describe("snapshot reproduction command", () => {
  it("keeps the comparison arguments and removes the export destination", () => {
    expect(snapshotReproductionCommand([
      "-C", "/work/project",
      "--exclude", "vendor code",
      "--export", "/tmp/review",
      "--pr", "42",
    ], "slopsplorer")).toBe(
      "# Install Slopsplorer\n"
      + "npm install -g slopsplorer\n\n"
      + "cd ~/path-to-your-repo/slopsplorer\n"
      + "slopsplorer --exclude 'vendor code' --pr 42",
    );
  });

  it("removes an equals-form export flag and quotes shell metacharacters", () => {
    expect(snapshotReproductionCommand([
      "main...feature/topic",
      "--export=review",
      "--exclude", "client's build",
    ], "client's app")).toBe(
      "# Install Slopsplorer\n"
      + "npm install -g slopsplorer\n\n"
      + "cd ~/path-to-your-repo/'client'\"'\"'s app'\n"
      + "slopsplorer main...feature/topic --exclude 'client'\"'\"'s build'",
    );
  });
});
