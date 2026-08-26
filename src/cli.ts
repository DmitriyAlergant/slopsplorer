#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MAX_FILE_BYTES, scanSourceTree } from "./scanner/scan.ts";
import type { ScanIndex, ScanOptions } from "./scanner/scan.ts";
import { isTokenizerName, TOKENIZERS } from "./scanner/tokenize.ts";
import { createSlopsplorerServer, resolvePackageRoot } from "./server/server.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;

/** Reading is IO-bound, so oversubscribing the core count is deliberate. */
const DEFAULT_CONCURRENCY = Math.max(4, os.availableParallelism());

const USAGE = `slopsplorer - local, token-weighted source tree explorer.

Usage: slopsplorer [root] [options]

  root                    Directory to scan. Defaults to the current directory.

Options:
  --host <address>        Interface to bind. Default ${DEFAULT_HOST}.
  --port <number>         Port to bind. Use 0 for any free port. Default ${DEFAULT_PORT}.
  --dev                   Serve the client through Vite with hot reload on the same port.
  --all-files             Ignore Git and .gitignore. Built-in directory exclusions still apply.
  --exclude <dir>         Skip a directory name anywhere in the tree. Repeatable.
  --tokenizer <name>      One of ${TOKENIZERS.join(", ")}. Default ${TOKENIZERS[0]}.
  --max-file-bytes <n>    Skip files larger than this. Default ${DEFAULT_MAX_FILE_BYTES} bytes.
  --concurrency <n>       Number of files to read in parallel. Default ${DEFAULT_CONCURRENCY} on this machine.
  --open                  Open the URL in the default browser when the scan finishes.
  --no-open               Do not open a browser. This is the default.
  -h, --help              Show this help.
  --version               Show the version.
`;

function fail(message: string): never {
  process.stderr.write(`slopsplorer: ${message}\n`);
  process.exit(1);
}

function parseIntegerOption(name: string, raw: string, minimum: number, maximum: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`--${name} expects an integer between ${minimum} and ${maximum}, got "${raw}"`);
  }
  return value;
}

function readPackageVersion(): string {
  const manifestPath = path.join(resolvePackageRoot(), "package.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = (manifest as { version?: unknown }).version;
  return typeof version === "string" ? version : "0.0.0";
}

/** Best-effort browser launch. A headless or locked-down box must still serve. */
function openInBrowser(url: string): void {
  const [command, commandArguments]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  execFile(command, commandArguments, () => {
    // Nothing to do: failing to open a browser is never a reason to stop serving.
  });
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function printScanSummary(index: ScanIndex, options: ScanOptions): void {
  const totalTokens = index.files.reduce((sum, file) => sum + file.tokens, 0);
  const source = index.meta.gitTracked
    ? "git ls-files"
    : index.meta.respectsGitignore
      ? "filesystem walk, .gitignore applied"
      : "filesystem walk, all files";
  const skipped = index.meta.skippedLargeFiles > 0
    ? `, ${formatCount(index.meta.skippedLargeFiles)} skipped over ${formatCount(options.maxFileBytes)} bytes`
    : "";
  const lines = [
    `root       ${path.resolve(options.root)}`,
    `files      ${formatCount(index.meta.fileCount)}${skipped}`,
    `folders    ${formatCount(index.meta.folderCount)}`,
    `tokens     ${formatCount(totalTokens)} (${index.meta.tokenizer})`,
    `scan       ${formatDuration(index.meta.durationMs)} via ${source}`,
    `grammars   ${index.meta.languages.length > 0 ? index.meta.languages.join(", ") : "none"}`,
  ];
  process.stderr.write(`${lines.map((line) => `  ${line}`).join("\n")}\n`);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        host: { type: "string" },
        port: { type: "string" },
        dev: { type: "boolean" },
        "all-files": { type: "boolean" },
        exclude: { type: "string", multiple: true },
        tokenizer: { type: "string" },
        "max-file-bytes": { type: "string" },
        concurrency: { type: "string" },
        open: { type: "boolean" },
        // parseArgs has no negation syntax, so the opt-out is its own flag.
        "no-open": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }

  const { values, positionals } = parsed;
  if (values.help === true) {
    process.stdout.write(USAGE);
    return;
  }
  if (values.version === true) {
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }
  if (positionals.length > 1) fail(`expected at most one root directory, got ${positionals.length}`);

  const root = path.resolve(positionals[0] ?? ".");
  const rootInfo = statSync(root, { throwIfNoEntry: false });
  if (rootInfo === undefined) fail(`no such directory: ${root}`);
  if (!rootInfo.isDirectory()) fail(`not a directory: ${root}`);

  const tokenizer = values.tokenizer ?? TOKENIZERS[0]!;
  if (!isTokenizerName(tokenizer)) {
    fail(`unknown tokenizer "${tokenizer}". Known tokenizers: ${TOKENIZERS.join(", ")}`);
  }

  const scanOptions: ScanOptions = {
    root,
    tokenizer,
    allFiles: values["all-files"] === true,
    exclude: values.exclude ?? [],
    maxFileBytes: values["max-file-bytes"] === undefined
      ? DEFAULT_MAX_FILE_BYTES
      : parseIntegerOption("max-file-bytes", values["max-file-bytes"], 1, Number.MAX_SAFE_INTEGER),
    concurrency: values.concurrency === undefined
      ? DEFAULT_CONCURRENCY
      : parseIntegerOption("concurrency", values.concurrency, 1, 1024),
  };

  const host = values.host ?? DEFAULT_HOST;
  const port = values.port === undefined ? DEFAULT_PORT : parseIntegerOption("port", values.port, 0, 65535);

  const index = await scanSourceTree(scanOptions);
  printScanSummary(index, scanOptions);

  const server = createSlopsplorerServer({ index, scanOptions, host, port, dev: values.dev === true });
  const address = await server.listen();
  process.stderr.write(`\n  slopsplorer ready on ${address.url}\n\n`);

  if (values.open === true && values["no-open"] !== true) openInBrowser(address.url);

  let shuttingDown = false;
  const shutDown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close().then(
      () => process.exit(0),
      () => process.exit(0),
    );
  };
  process.on("SIGINT", shutDown);
  process.on("SIGTERM", shutDown);
}

await main();
