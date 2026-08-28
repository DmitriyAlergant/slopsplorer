import { describe, expect, it } from "vitest";
import type { UserConfig } from "vite";
import configuration from "../vite.config.ts";

describe("the two production entries", () => {
  it("keeps live entry assets root-based and snapshot assets relative", () => {
    const config = configuration as UserConfig;
    const renderBuiltUrl = config.experimental?.renderBuiltUrl;

    expect(config.base).not.toBe("./");
    expect(renderBuiltUrl).toBeTypeOf("function");
    expect(renderBuiltUrl!("assets/index.js", {
      type: "asset", hostId: "index.html", hostType: "html", ssr: false,
    })).toBeUndefined();
    expect(renderBuiltUrl!("assets/snapshot.js", {
      type: "asset", hostId: "snapshot.html", hostType: "html", ssr: false,
    })).toBe("./assets/snapshot.js");
    expect(renderBuiltUrl!("assets/worker.js", {
      type: "asset", hostId: "assets/snapshot.js", hostType: "js", ssr: false,
    })).toEqual({ relative: true });
  });
});
