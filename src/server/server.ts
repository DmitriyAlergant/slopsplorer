import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { diffOneFile, scanDiff } from "../scanner/diffScan.ts";
import type { DiffScanOptions } from "../scanner/diffScan.ts";
import { GitError, listRefs, resolveComparison, verifyComparisonRequest } from "../scanner/gitdiff.ts";
import { scanSourceTree } from "../scanner/scan.ts";
import type { ScanIndex, ScanOptions } from "../scanner/scan.ts";
import type {
  CompareRequest, ComparisonRequest, DiffLine, OpenRootRequest, SkillInstallResponse, SourceResponse,
} from "../shared/api.ts";
import { buildView, parseViewRequest } from "./aggregate.ts";

/** Ceiling on `POST` bodies. A view request is a few kilobytes even for a huge tree. */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Ceiling on a source preview, so one generated bundle cannot stall the browser. */
const MAX_SOURCE_BYTES = 512 * 1024;

/**
 * Cut a compared file at the same ceiling a previewed file gets, on a line
 * boundary. `totalBytes` counts the whole change, so the note the page draws
 * says how much was left out.
 */
function takeUpToByteCeiling(aligned: readonly DiffLine[]): { lines: DiffLine[]; totalBytes: number } {
  let totalBytes = 0;
  let kept = aligned.length;
  for (const [index, line] of aligned.entries()) {
    totalBytes += Buffer.byteLength(line.text) + 1;
    if (totalBytes > MAX_SOURCE_BYTES && index < kept) kept = index;
  }
  return { lines: aligned.slice(0, kept), totalBytes };
}

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

/** A valid request that cannot run until the active scan finishes. */
class ConflictError extends Error {}

/**
 * Read a comparison out of an untrusted body.
 *
 * Every branch names its own fields, so a request that reaches
 * `resolveComparison` is one of the five comparisons and nothing else.
 */
function parseComparisonRequest(raw: unknown): ComparisonRequest {
  const candidate = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const revision = (key: string): string => {
    const value = candidate[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new BadRequestError(`\`comparison.${key}\` must name a revision`);
    }
    return value.trim();
  };
  switch (candidate["kind"]) {
    case "workingTree": return { kind: "workingTree" };
    case "staged": return { kind: "staged" };
    case "revisionToWorkingTree": return { kind: "revisionToWorkingTree", rev: revision("rev") };
    case "revisionPair": return { kind: "revisionPair", base: revision("base"), target: revision("target") };
    case "mergeBase": return { kind: "mergeBase", base: revision("base"), target: revision("target") };
    default: throw new BadRequestError("`comparison.kind` must name one of the five comparisons");
  }
}

/**
 * What produces the index, and what a rescan therefore repeats.
 *
 * Opening a folder always installs a scan producer, because a directory is not
 * a comparison and quietly keeping the old one would leave the page reporting
 * churn for a tree nobody compared.
 */
export type IndexProducer =
  | { kind: "scan"; options: ScanOptions }
  | { kind: "diff"; options: DiffScanOptions };

export interface SlopsplorerServerOptions {
  /** The index the server starts with, so the CLI can report the scan before listening. */
  index: ScanIndex;
  /** Reused verbatim by `POST /api/rescan`, so a rescan sees the same scope. */
  producer: IndexProducer;
  host: string;
  port: number;
  /**
   * Ports tried in order from `port`, so a stale listener on the default port
   * does not stop a run. A port the user named passes 1, because moving off a
   * chosen port would serve the page somewhere nobody asked for.
   */
  portAttempts: number;
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
 * The index and its scan options move together so source reads can never use a new index with an old root, or vice versa.
 */

const MAX_TCP_PORT = 65535;

/** `EADDRINUSE`, whichever layer raised it. */
export function isAddressInUse(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === "EADDRINUSE";
}

function bindPort(httpServer: Server, host: string, port: number): Promise<AddressInfo> {
  return new Promise<AddressInfo>((resolve, reject) => {
    const onError = (error: Error): void => {
      httpServer.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      httpServer.removeListener("error", onError);
      const bound = httpServer.address();
      if (bound === null || typeof bound === "string") {
        reject(new Error("server did not bind to a TCP port"));
        return;
      }
      resolve(bound);
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, host);
  });
}

/**
 * Bind the first free port from `firstPort`.
 *
 * A failed bind leaves the server unlistened, so the next port is a second
 * `listen()` on the same object. `EADDRINUSE` on the last port in the range
 * reaches the caller, which is how a named port stays a named port.
 */
async function bindFirstFreePort(
  httpServer: Server, host: string, firstPort: number, attempts: number,
): Promise<AddressInfo> {
  // Port 0 asks the operating system for a free port, so there is nothing to step through.
  const span = firstPort === 0 ? 1 : Math.max(1, attempts);
  for (let offset = 0; ; offset += 1) {
    const port = firstPort + offset;
    try {
      return await bindPort(httpServer, host, port);
    } catch (cause) {
      const isLast = offset + 1 >= span || port + 1 > MAX_TCP_PORT;
      if (isLast || !isAddressInUse(cause)) throw cause;
    }
  }
}

export function createSlopsplorerServer(options: SlopsplorerServerOptions): SlopsplorerServer {
  const packageRoot = resolvePackageRoot();
  const staticRoot = path.join(packageRoot, "dist", "web");
  const skillInstall = buildSkillInstall(packageRoot);

  let scanState = { index: options.index, producer: options.producer };
  let scanInFlight: { label: string; promise: Promise<ScanIndex> } | null = null;
  let vite: ViteDevServer | null = null;

  /**
   * What a running measurement is of, so a repeat of it can join it.
   *
   * A comparison carries its spec, because two comparisons of one repository
   * are two different measurements and joining them would answer the second
   * with the first one's figures.
   */
  function producerLabel(producer: IndexProducer): string {
    return producer.kind === "diff"
      ? `${producer.options.root} (${producer.options.comparison.spec})`
      : producer.options.root;
  }

  /** Replace the complete state only after a scan succeeds. */
  function runScan(producer: IndexProducer): Promise<ScanIndex> {
    const label = producerLabel(producer);
    if (scanInFlight) {
      if (scanInFlight.label === label) return scanInFlight.promise;
      throw new ConflictError(`already scanning ${scanInFlight.label}`);
    }
    const measuring = producer.kind === "diff" ? scanDiff(producer.options) : scanSourceTree(producer.options);
    const running = measuring.then((next) => {
      scanState = { index: next, producer };
      return next;
    });
    const activeScan = { label, promise: running };
    scanInFlight = activeScan;
    const release = (): void => {
      if (scanInFlight === activeScan) scanInFlight = null;
    };
    running.then(release, release);
    return running;
  }

  /** Coalesce concurrent rescans of the active root. */
  function rescan(): Promise<ScanIndex> {
    return runScan(scanState.producer);
  }

  async function parseOpenRootRequest(body: unknown): Promise<OpenRootRequest> {
    if (typeof body !== "object" || body === null) throw new BadRequestError("request body must be an object");
    const candidate = body as { root?: unknown; view?: unknown };
    if (typeof candidate.root !== "string" || candidate.root.trim() === "") {
      throw new BadRequestError("`root` must be a non-empty absolute directory path");
    }
    const requestedRoot = candidate.root.trim();
    if (!path.isAbsolute(requestedRoot)) {
      throw new BadRequestError("`root` must be an absolute directory path");
    }
    let rootInfo;
    try {
      rootInfo = await stat(requestedRoot);
    } catch {
      throw new BadRequestError(`directory does not exist or is not readable: ${requestedRoot}`);
    }
    if (!rootInfo.isDirectory()) throw new BadRequestError(`not a directory: ${requestedRoot}`);
    return { root: path.resolve(requestedRoot), view: parseViewRequest(candidate.view) };
  }

  function parseCompareRequest(body: unknown): CompareRequest {
    if (typeof body !== "object" || body === null) throw new BadRequestError("request body must be an object");
    const candidate = body as { comparison?: unknown; view?: unknown };
    return { comparison: parseComparisonRequest(candidate.comparison), view: parseViewRequest(candidate.view) };
  }

  async function handleSource(response: ServerResponse, url: URL): Promise<void> {
    const state = scanState;
    const requestedPath = url.searchParams.get("path");
    if (requestedPath === null) throw new BadRequestError("missing `path` query parameter");

    // The index is the allowlist: only files the scan accepted are readable.
    const fileIndex = state.index.fileIndexByPath.get(requestedPath);
    if (fileIndex === undefined) {
      sendJson(response, 404, { error: "file is not part of the current scan" });
      return;
    }
    const row = state.index.files[fileIndex]!;

    // Inside a diff, a file has two contents, so showing either one alone
    // would be a claim the page cannot support. Both sides go over whole and
    // the page decides how much of the unchanged text to draw.
    if (state.producer.kind === "diff") {
      const aligned = await diffOneFile(state.producer.options, row);
      const kept = takeUpToByteCeiling(aligned);
      const payload: SourceResponse = {
        path: row.path,
        lines: kept.lines,
        mode: "diff",
        truncated: kept.lines.length < aligned.length,
        totalBytes: kept.totalBytes,
        language: row.language,
      };
      sendJson(response, 200, payload);
      return;
    }

    const scanRoot = path.resolve(state.producer.options.root);
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
      mode: "source",
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
        sendJson(response, 200, buildView(scanState.index, parseViewRequest(await readJsonBody(request))));
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
      case "/api/open": {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "use POST" });
          return;
        }
        const openRequest = await parseOpenRootRequest(await readJsonBody(request));
        const previous = scanState.producer;
        const scanOptions: ScanOptions = previous.kind === "scan"
          ? { ...previous.options, root: openRequest.root }
          : {
            root: openRequest.root,
            tokenizer: previous.options.tokenizer,
            allFiles: false,
            exclude: previous.options.exclude,
            maxFileBytes: previous.options.maxFileBytes,
            concurrency: previous.options.concurrency,
          };
        const opened = await runScan({ kind: "scan", options: scanOptions });
        sendJson(response, 200, buildView(opened, openRequest.view));
        return;
      }
      case "/api/compare": {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "use POST" });
          return;
        }
        const compareRequest = parseCompareRequest(await readJsonBody(request));
        const previous = scanState.producer;
        // Only a comparison can be recompared: a scan has no repository the
        // page could name a second revision against.
        if (previous.kind !== "diff") {
          throw new BadRequestError("the open index is a scan, so there is nothing to compare against");
        }
        const root = previous.options.root;
        let comparison;
        try {
          await verifyComparisonRequest(root, compareRequest.comparison);
          comparison = await resolveComparison(root, compareRequest.comparison);
        } catch (cause) {
          // The picker offers what the repository holds, so a name it does not
          // is the caller's mistake and not a fault of ours.
          if (!(cause instanceof GitError)) throw cause;
          throw new BadRequestError(cause.message);
        }
        const compared = await runScan({ kind: "diff", options: { ...previous.options, comparison } });
        sendJson(response, 200, buildView(compared, compareRequest.view));
        return;
      }
      case "/api/refs": {
        // Only a comparison has a repository, and only the picker asks.
        if (scanState.producer.kind !== "diff") {
          throw new BadRequestError("the open index is a scan, so it has no repository to list refs from");
        }
        sendJson(response, 200, await listRefs(scanState.producer.options.root));
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
        sendJson(response, 200, { status: "ok", meta: scanState.index.meta });
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
      if (error instanceof ConflictError) {
        sendJson(response, 409, { error: error.message });
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

      const bound = await bindFirstFreePort(httpServer, options.host, options.port, options.portAttempts);
      // A wildcard bind is not a usable address to click on.
      const displayHost =
        bound.address === "0.0.0.0" || bound.address === "::" ? "127.0.0.1" : bound.address;
      const bracketed = displayHost.includes(":") ? `[${displayHost}]` : displayHost;
      return { host: bound.address, port: bound.port, url: `http://${bracketed}:${bound.port}` };
    },
    async close(): Promise<void> {
      // Start closing the listener first so a watch restart can reclaim the port,
      // then close Vite concurrently because its upgraded HMR socket prevents the
      // HTTP close callback from firing until Vite tears that socket down.
      const httpClosed = new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Keep-alive sockets would otherwise hold the close open until they time out.
        httpServer.closeAllConnections();
      });
      const activeVite = vite;
      vite = null;
      await Promise.all([httpClosed, activeVite?.close() ?? Promise.resolve()]);
    },
  };
}
