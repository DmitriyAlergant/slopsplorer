import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaticSpineDialog } from "../src/web/components/StaticSpineDialog.tsx";

describe("the static commit analysis dialog", () => {
  it("explains the local requirement and provides the original comparison command", () => {
    const html = renderToStaticMarkup(
      <StaticSpineDialog
        open
        command={[
          "# Install Slopsplorer",
          "npm install -g slopsplorer",
          "",
          "cd ~/path-to-your-repo/slopsplorer",
          "slopsplorer --pr 42",
        ].join("\n")}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Slice commits locally");
    expect(html).toContain("Slicing by commit spans is only possible in a local Slopsplorer scan.");
    expect(html).toContain("# Install Slopsplorer\nnpm install -g slopsplorer\n\ncd ~/path-to-your-repo/slopsplorer\nslopsplorer --pr 42");
    expect(html).toContain("Copy command");
  });
});
