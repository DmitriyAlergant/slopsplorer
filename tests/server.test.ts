import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createTcpServer, connect, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSourceTree } from "../src/scanner/scan.ts";
import { createSlopsplorerServer, isAddressInUse, type SlopsplorerServer } from "../src/server/server.ts";
import type { SkillInstallResponse, SourceResponse, ViewResponse } from "../src/shared/api.ts";

const SCAN_TIMEOUT_MS = 60_000;

let fixtureRoot: string;
let initialRoot: string;
let nextRoot: string;
let server: SlopsplorerServer;
let serverUrl: string;

/** Open the same upgraded socket Vite's browser client holds, without a WebSocket dependency. */
function openHotReloadSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, host);
    const fail = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write([
        "GET / HTTP/1.1",
        `Host: ${host}:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Protocol: vite-hmr",
        "",
        "",
      ].join("\r\n"));
    });
    socket.once("data", (data) => {
      socket.removeListener("error", fail);
      if (!data.toString("utf8").startsWith("HTTP/1.1 101")) {
        fail(new Error("hot-reload socket upgrade was rejected"));
        return;
      }
      resolve(socket);
    });
  });
}

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
  server = createSlopsplorerServer({ index, producer: { kind: "scan", options: scanOptions }, host: "127.0.0.1", port: 0, portAttempts: 1 });
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
    const source = await sourceResponse.json() as Extract<SourceResponse, { mode: "source" }>;
    expect(source).toMatchObject({ mode: "source", content: "export const next = true;\n" });

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

  it("refuses to recompare a scan, which has nothing to compare against", async () => {
    const compareResponse = await fetch(`${serverUrl}/api/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comparison: { kind: "workingTree" }, view: {} }),
    });
    expect(compareResponse.status).toBe(400);
    await expect(compareResponse.json()).resolves.toEqual({
      error: "the open index is a scan, so there is nothing to compare against",
    });

    const refsResponse = await fetch(`${serverUrl}/api/refs`);
    expect(refsResponse.status).toBe(400);
  });
});

describe("the bundled agent skill", () => {
  it("copies itself into every directory it reports, with no symlink", async () => {
    const response = await fetch(`${serverUrl}/api/skill-install`);
    expect(response.status).toBe(200);
    const install = await response.json() as SkillInstallResponse;

    expect(install.targets.map((target) => target.tool)).toEqual(["Claude Code", "Codex and other agents"]);
    for (const target of install.targets) {
      expect(target.path.endsWith("slopsplorer")).toBe(true);
      expect(install.command).toContain(target.path);
    }
    expect(install.command).toContain(process.platform === "win32" ? "Copy-Item" : "cp -R");
    expect(install.command).not.toContain("ln -s");
  });

  it("serves SKILL.md to the preview dialog", async () => {
    const response = await fetch(`${serverUrl}/api/skill-source`);
    expect(response.status).toBe(200);
    const source = await response.json() as Extract<SourceResponse, { mode: "source" }>;
    const onDisk = await readFile(new URL("../skill/SKILL.md", import.meta.url), "utf8");
    expect(source).toMatchObject({ mode: "source", path: "SKILL.md", truncated: false, content: onDisk });
  });
});

describe("development server shutdown", () => {
  it("closes while a browser has an active hot-reload socket", async () => {
    const scanOptions = {
      root: initialRoot,
      tokenizer: "cl100k_base" as const,
      allFiles: true,
      exclude: [],
      maxFileBytes: 2 * 1024 * 1024,
      concurrency: 2,
    };
    const index = await scanSourceTree(scanOptions);
    const developmentServer = createSlopsplorerServer({
      index,
      producer: { kind: "scan", options: scanOptions },
      host: "127.0.0.1",
      port: 0,
      portAttempts: 1,
      dev: true,
    });
    const address = await developmentServer.listen();
    const socket = await openHotReloadSocket(address.host, address.port);

    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const closing = developmentServer.close();
    await Promise.race([
      closing,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          socket.destroy();
          resolve();
        }, 2_000);
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    await closing;
    socket.destroy();

    expect(timedOut).toBe(false);
  });
}, SCAN_TIMEOUT_MS);

/** Hold a port the way a process left behind by an earlier run holds one. */
function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const holder = createTcpServer();
    holder.once("error", reject);
    holder.listen(0, "127.0.0.1", () => {
      const address = holder.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the holder did not bind to a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        release: () => new Promise<void>((done) => holder.close(() => done())),
      });
    });
  });
}

describe("binding a port", () => {
  const scanOptions = {
    tokenizer: "cl100k_base" as const,
    allFiles: true,
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 2,
  };

  it("walks forward to a free port when the first one is in use", async () => {
    const held = await occupyPort();
    const options = { ...scanOptions, root: initialRoot };
    const index = await scanSourceTree(options);
    const walker = createSlopsplorerServer({
      index, producer: { kind: "scan", options }, host: "127.0.0.1", port: held.port, portAttempts: 5,
    });
    try {
      const address = await walker.listen();
      expect(address.port).toBeGreaterThan(held.port);
      expect(address.port).toBeLessThanOrEqual(held.port + 4);
      const health = await fetch(`${address.url}/api/health`);
      expect(health.status).toBe(200);
    } finally {
      await walker.close();
      await held.release();
    }
  }, SCAN_TIMEOUT_MS);

  it("fails on the port it was given when it may try only one", async () => {
    const held = await occupyPort();
    const options = { ...scanOptions, root: initialRoot };
    const index = await scanSourceTree(options);
    const strict = createSlopsplorerServer({
      index, producer: { kind: "scan", options }, host: "127.0.0.1", port: held.port, portAttempts: 1,
    });
    try {
      await expect(strict.listen()).rejects.toSatisfy(isAddressInUse);
    } finally {
      await strict.close();
      await held.release();
    }
  }, SCAN_TIMEOUT_MS);
});
