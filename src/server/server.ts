import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { scanSourceTree } from "../scanner/scan.ts";
import type { ScanIndex, ScanOptions } from "../scanner/scan.ts";
import type { SkillInstallResponse, SourceResponse } from "../shared/api.ts";
import { buildView, parseViewRequest } from "./aggregate.ts";

/** Ceiling on `POST` bodies. A view request is a few kilobytes even for a huge tree. */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Ceiling on a source preview, so one generated bundle cannot stall the browser. */
const MAX_SOURCE_BYTES = 512 * 1024;

const SKILL_NAME = "slopsplorer";

/** Canonical, tool-agnostic skill location. Claude Code reads it through a symlink. */
const SKILL_TARGET_PATH = "~/.agents/skills/slopsplorer";
const SKILL_LINK_PATH = "~/.claude/skills/slopsplorer";

const STATIC_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/** A request the client got wrong. Reported as 400 rather than logged as a fault. */
class BadRequestError extends Error {}

export interface SlopsplorerServerOptions {
  /** The index the server starts with, so the CLI can report the scan before listening. */
  index: ScanIndex;
  /** Reused verbatim by `POST /api/rescan`, so a rescan sees the same scope. */
  scanOptions: ScanOptions;
  host: string;
  port: number;
  /** Serve the client through Vite in middleware mode instead of `dist/web`. */
  dev?: boolean;
}

export interface ServerAddress {
  host: string;
  port: number;
  url: string;
}

export interface SlopsplorerServer {
  httpServer: Server;
  listen(): Promise<ServerAddress>;
  close(): Promise<void>;
}

/**
 * Locate the installed package root by walking up from this module.
 *
 * The compiled server lands in `dist/node/server/`, but tests import the source
 * from `src/server/`, so the depth differs. The nearest enclosing `package.json`
 * is the same directory either way.
 */
export function resolvePackageRoot(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(directory, "package.json"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return directory;
    directory = parent;
  }
}

/** Wrap a path for POSIX shells, which treat everything inside single quotes literally. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function buildSkillInstall(packageRoot: string): SkillInstallResponse {
  const source = shellQuote(path.join(packageRoot, "skill"));
  // `~` stays unexpanded so the command reads the same on any machine and the
  // user's own shell resolves it. ` && ` stops the chain at the first failure.
  const command = [
    `mkdir -p ~/.agents/skills ~/.claude/skills`,
    `rm -rf ${SKILL_TARGET_PATH}`,
    `cp -R ${source} ${SKILL_TARGET_PATH}`,
    `ln -sfn ${SKILL_TARGET_PATH} ${SKILL_LINK_PATH}`,
  ].join(" && ");
  return { skillName: SKILL_NAME, command, targetPath: SKILL_TARGET_PATH, linkPath: SKILL_LINK_PATH };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.byteLength,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      finish();
    };

    request.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        // Stop buffering, but leave the socket alive so the 400 still reaches the client.
        request.pause();
        settle(() => reject(new BadRequestError("request body exceeds 1 MiB")));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      settle(() => {
        if (total === 0) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new BadRequestError("request body is not valid JSON"));
        }
      });
    });
    request.on("error", (error: Error) => settle(() => reject(error)));
  });
}

/**
 * Map a URL path onto a file inside `staticRoot`, or null when it escapes.
 *
 * Traversal is rejected on the resolved path rather than on the raw string, so
 * encoded and mixed-separator forms collapse before the containment check.
 */
function resolveStaticFile(staticRoot: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const candidate = path.resolve(staticRoot, `.${path.posix.normalize(decoded)}`);
  const relative = path.relative(staticRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

async function sendStaticFile(response: ServerResponse, filePath: string): Promise<void> {
  const body = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const isHashedAsset = path.basename(path.dirname(filePath)) === "assets";
  response.writeHead(200, {
    "Content-Type": STATIC_CONTENT_TYPES[extension] ?? "application/octet-stream",
    "Content-Length": body.byteLength,
    // Vite content-hashes everything under `assets/`. The entry document must not stick.
    "Cache-Control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

/**
 * Create the local HTTP server.
 *
 * The index is held in a mutable closure variable because `POST /api/rescan`
 * replaces it in place. Every later request then aggregates over the new scan.
 */
export function createSlopsplorerServer(options: SlopsplorerServerOptions): SlopsplorerServer {
  const packageRoot = resolvePackageRoot();
  const staticRoot = path.join(packageRoot, "dist", "web");
  const skillInstall = buildSkillInstall(packageRoot);

  let index = options.index;
  let rescanInFlight: Promise<ScanIndex> | null = null;
  let vite: ViteDevServer | null = null;

  /** Coalesce concurrent rescans. A second click joins the running scan. */
  function rescan(): Promise<ScanIndex> {
    if (rescanInFlight) return rescanInFlight;
    const running = scanSourceTree(options.scanOptions).then((next) => {
      index = next;
      return next;
    });
    rescanInFlight = running;
    const release = (): void => {
      if (rescanInFlight === running) rescanInFlight = null;
    };
    running.then(release, release);
    return running;
  }

  async function handleSource(response: ServerResponse, url: URL): Promise<void> {
    const requestedPath = url.searchParams.get("path");
    if (requestedPath === null) throw new BadRequestError("missing `path` query parameter");

    // The index is the allowlist: only files the scan accepted are readable.
    const fileIndex = index.fileIndexByPath.get(requestedPath);
    if (fileIndex === undefined) {
      sendJson(response, 404, { error: "file is not part of the current scan" });
      return;
    }
    const row = index.files[fileIndex]!;

    const scanRoot = path.resolve(options.scanOptions.root);
    const absolutePath = path.resolve(scanRoot, requestedPath);
    let realFilePath: string;
    let realScanRoot: string;
    try {
      realFilePath = await realpath(absolutePath);
      realScanRoot = await realpath(scanRoot);
    } catch {
      sendJson(response, 404, { error: "file is no longer readable" });
      return;
    }
    // Defence in depth: a symlink added since the scan must not read outside the root.
    const relative = path.relative(realScanRoot, realFilePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      sendJson(response, 403, { error: "file resolves outside the scan root" });
      return;
    }

    const buffer = await readFile(realFilePath);
    const truncated = buffer.byteLength > MAX_SOURCE_BYTES;
    // The decoder drops a trailing partial code point instead of emitting U+FFFD.
    const content = truncated
      ? new StringDecoder("utf8").write(buffer.subarray(0, MAX_SOURCE_BYTES))
      : buffer.toString("utf8");
    const payload: SourceResponse = {
      path: row.path,
      content,
      truncated,
      totalBytes: buffer.byteLength,
      language: row.language,
    };
    sendJson(response, 200, payload);
  }

  async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    switch (url.pathname) {
      case "/api/view": {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "use POST" });
          return;
        }
        sendJson(response, 200, buildView(index, parseViewRequest(await readJsonBody(request))));
        return;
      }
      case "/api/rescan": {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "use POST" });
          return;
        }
        const viewRequest = parseViewRequest(await readJsonBody(request));
        const rescanned = await rescan();
        sendJson(response, 200, buildView(rescanned, viewRequest));
        return;
      }
      case "/api/source": {
        await handleSource(response, url);
        return;
      }
      case "/api/skill-install": {
        sendJson(response, 200, skillInstall);
        return;
      }
      case "/api/health": {
        sendJson(response, 200, { status: "ok", meta: index.meta });
        return;
      }
      default: {
        sendJson(response, 404, { error: "unknown endpoint" });
      }
    }
  }

  async function handleStatic(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (vite) {
      vite.middlewares(request, response);
      return;
    }

    const filePath = resolveStaticFile(staticRoot, url.pathname);
    if (filePath !== null) {
      const info = await stat(filePath).catch(() => null);
      if (info?.isFile()) {
        await sendStaticFile(response, filePath);
        return;
      }
    }

    // Client routing: any unmatched path outside `/api/` renders the SPA shell.
    const indexHtml = path.join(staticRoot, "index.html");
    if (existsSync(indexHtml)) {
      await sendStaticFile(response, indexHtml);
      return;
    }
    sendJson(response, 404, { error: "client assets are missing. Run `npm run build:web`." });
  }

  const httpServer = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const handled = url.pathname.startsWith("/api/")
      ? handleApi(request, response, url)
      : handleStatic(request, response, url);
    handled.catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof BadRequestError) {
        // The rest of a rejected body may still be in flight. Drop the connection
        // after the reply rather than reading bytes we already refused.
        if (!request.readableEnded) response.setHeader("Connection", "close");
        sendJson(response, 400, { error: error.message });
        return;
      }
      // A bad request must never take the process down with it.
      console.error("slopsplorer: request failed", error);
      sendJson(response, 500, { error: "internal server error" });
    });
  });

  return {
    httpServer,
    async listen(): Promise<ServerAddress> {
      if (options.dev === true) {
        // Vite and the React plugin are devDependencies, so these imports must
        // stay unreachable in a normal install.
        const { createServer: createViteServer } = await import("vite");
        const { default: reactPlugin } = await import("@vitejs/plugin-react");
        // The config is inline rather than read from `vite.config.ts`. Vite
        // bundles a TypeScript config into a temporary file beside it on every
        // start, and that file lands inside the tree `node --watch` observes,
        // so `npm run dev` would restart itself forever. The two settings that
        // matter in middleware mode are repeated here. `vite.config.ts` still
        // owns the build.
        vite = await createViteServer({
          configFile: false,
          root: path.join(packageRoot, "src", "web"),
          plugins: [reactPlugin()],
          // Handing Vite the HTTP server puts hot-reload messages on the port
          // that is already open, instead of opening a second one.
          server: { middlewareMode: true, hmr: { server: httpServer } },
          appType: "spa",
          // Vite's info output would repaint over the CLI summary and log every request.
          logLevel: "warn",
          clearScreen: false,
        });
      }

      const address = await new Promise<ServerAddress>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(options.port, options.host, () => {
          httpServer.removeListener("error", reject);
          const bound = httpServer.address();
          if (bound === null || typeof bound === "string") {
            reject(new Error("server did not bind to a TCP port"));
            return;
          }
          // A wildcard bind is not a usable address to click on.
          const displayHost =
            bound.address === "0.0.0.0" || bound.address === "::" ? "127.0.0.1" : bound.address;
          const bracketed = displayHost.includes(":") ? `[${displayHost}]` : displayHost;
          resolve({ host: bound.address, port: bound.port, url: `http://${bracketed}:${bound.port}` });
        });
      });
      return address;
    },
    async close(): Promise<void> {
      // The listening socket goes first, so the port is free before the slower
      // Vite teardown runs. `npm run dev` restarts within milliseconds of the
      // old process being signalled, and the new one has to be able to bind.
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Keep-alive sockets would otherwise hold the close open until they time out.
        httpServer.closeAllConnections();
      });
      if (vite) {
        await vite.close();
        vite = null;
      }
    },
  };
}
