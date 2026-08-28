import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareStaticBundleOutput } from "../src/server/export.ts";

describe("a static bundle output directory", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-export-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a missing directory", async () => {
    const output = path.join(root, "nested", "site");
    await expect(prepareStaticBundleOutput(output)).resolves.toBeUndefined();
    await expect(prepareStaticBundleOutput(output)).resolves.toBeUndefined();
  });

  it("accepts an existing empty directory", async () => {
    const output = path.join(root, "site");
    await mkdir(output);
    await expect(prepareStaticBundleOutput(output)).resolves.toBeUndefined();
  });

  it("refuses a non-empty directory without changing it", async () => {
    const output = path.join(root, "site");
    await mkdir(output);
    const held = path.join(output, "keep.txt");
    await writeFile(held, "mine\n", "utf8");

    await expect(prepareStaticBundleOutput(output)).rejects.toThrow(/not empty/);
    await expect(prepareStaticBundleOutput(held)).rejects.toThrow(/not a directory/);
  });
});
