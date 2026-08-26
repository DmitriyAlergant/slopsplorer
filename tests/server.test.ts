import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSourceTree } from "../src/scanner/scan.ts";
import { createSlopsplorerServer, type SlopsplorerServer } from "../src/server/server.ts";
import type { SourceResponse, ViewResponse } from "../src/shared/api.ts";

const SCAN_TIMEOUT_MS = 60_000;

let fixtureRoot: string;
let initialRoot: string;
let nextRoot: string;
let server: SlopsplorerServer;
let serverUrl: string;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-server-"));
  initialRoot = path.join(fixtureRoot, "initial");
  nextRoot = path.join(fixtureRoot, "next");
  await mkdir(initialRoot);
  await mkdir(nextRoot);
  await writeFile(path.join(initialRoot, "initial.ts"), "export const initial = true;\n", "utf8");
  await writeFile(path.join(nextRoot, "next.ts"), "export const next = true;\n", "utf8");

  const scanOptions = {
    root: initialRoot,
    tokenizer: "cl100k_base" as const,
    allFiles: true,
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 2,
  };
  const index = await scanSourceTree(scanOptions);
  server = createSlopsplorerServer({ index, scanOptions, host: "127.0.0.1", port: 0 });
  serverUrl = (await server.listen()).url;
}, SCAN_TIMEOUT_MS);

afterAll(async () => {
  await server.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("opening a scan root", () => {
  it("switches the index and source-preview root together", async () => {
    const openResponse = await fetch(`${serverUrl}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: nextRoot,
        view: { kinds: ["code", "test", "text", "i18n", "data", "other"] },
      }),
    });
    expect(openResponse.status).toBe(200);
    const view = await openResponse.json() as ViewResponse;
    expect(view.meta.rootPath).toBe(nextRoot);
    expect(view.meta.fileCount).toBe(1);
    expect(view.ranked.map((file) => file.path)).toEqual(["next.ts"]);

    const sourceResponse = await fetch(`${serverUrl}/api/source?path=next.ts`);
    expect(sourceResponse.status).toBe(200);
    const source = await sourceResponse.json() as SourceResponse;
    expect(source.content).toBe("export const next = true;\n");

    const oldSourceResponse = await fetch(`${serverUrl}/api/source?path=initial.ts`);
    expect(oldSourceResponse.status).toBe(404);
  });

  it("rejects a relative path without replacing the active scan", async () => {
    const openResponse = await fetch(`${serverUrl}/api/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: "../somewhere", view: {} }),
    });
    expect(openResponse.status).toBe(400);
    await expect(openResponse.json()).resolves.toEqual({ error: "`root` must be an absolute directory path" });

    const healthResponse = await fetch(`${serverUrl}/api/health`);
    const health = await healthResponse.json() as { meta: { rootPath: string } };
    expect(health.meta.rootPath).toBe(nextRoot);
  });
});
