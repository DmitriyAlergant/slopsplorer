#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { scanDiff, type DiffScanOptions } from "./scanner/diffScan.ts";
import {
  GitError, parseComparisonSpec, parseRevisionArgument, repositoryRoot, resolveComparison,
  verifyComparisonRequest, type Comparison,
} from "./scanner/gitdiff.ts";
import { DEFAULT_MAX_FILE_BYTES, scanSourceTree } from "./scanner/scan.ts";
import type { ScanIndex, ScanOptions, ScanProgress } from "./scanner/scan.ts";
import type { ComparisonRequest } from "./shared/api.ts";
import { DEFAULT_TOKENIZER, isTokenizerName, TOKENIZERS } from "./scanner/tokenize.ts";
import { createSlopsplorerServer, resolvePackageRoot, type IndexProducer } from "./server/server.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;

/** Reading is IO-bound, so oversubscribing the core count is deliberate. */
const DEFAULT_CONCURRENCY = Math.max(4, os.availableParallelism());

/** Erase the whole progress line, so a shorter update cannot leave a tail behind. */
const CLEAR_LINE = "\u001B[2K";

const USAGE = `slopsplorer - local, token-weighted source tree explorer.

USAGE
  slopsplorer [<dir>] [options]           Scan a source tree. Default: current folder.
  slopsplorer --diff [options]            Compare HEAD against the working tree,
                                          untracked files included.
  slopsplorer --staged [options]          Compare HEAD against the index.
  slopsplorer <rev> [options]             Compare <rev> against the working tree.
  slopsplorer <revA> <revB> [options]     Compare <revA> against <revB>.
  slopsplorer <revA>..<revB> [options]    The same, written as a range.
  slopsplorer <revA>...<revB> [options]   Compare the merge base of A and B against B.

  A single positional is read as a directory if a directory exists at that path,
  otherwise as a revision.

OPTIONS
  -C <dir>                Run as if started in <dir>. A comparison uses this to
                          locate the repository.
  --host <address>        Interface to bind. Default ${DEFAULT_HOST}.
  --port <number>         Port to bind. Use 0 for any free port. Default ${DEFAULT_PORT}.
  --dev                   Serve the client through Vite with hot reload on the
                          same port.
  --all-files             Ignore Git and .gitignore. Built-in directory exclusions
                          still apply. Scan mode only; rejected with a comparison.
  --exclude <dir>         Skip a directory name anywhere in the tree. Repeatable.
                          Applies to both modes.
  --tokenizer <name>      One of ${TOKENIZERS.join(", ")}. Default ${DEFAULT_TOKENIZER}.
  --max-file-bytes <n>    Skip files larger than this. Default ${DEFAULT_MAX_FILE_BYTES} bytes.
                          In a comparison, either side over the limit skips the file.
  --concurrency <n>       Files measured in parallel. Default ${DEFAULT_CONCURRENCY} on this machine.
  --open                  Open the URL in the default browser when the scan finishes.
                          This is the default outside --dev.
  --no-open               Do not open a browser.
  -h, --help              Show this help.
  --version               Show the version.

EXAMPLES
  slopsplorer                     Scan the current folder.
  slopsplorer ../other-project    Scan a folder elsewhere.
  slopsplorer --diff              Compare HEAD against the working tree.
  slopsplorer --staged            Compare HEAD against the index.
  slopsplorer main...HEAD         Compare the merge base of main and HEAD to HEAD.
  slopsplorer HEAD~5              Compare HEAD~5 against the working tree.
  slopsplorer origin/main         All work since origin/main, uncommitted included.
  slopsplorer -C ~/src/app v1 v2  Compare two revisions of a repository elsewhere.
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

/** Signed, because a net figure that lost its sign states the opposite of the truth. */
function formatSigned(value: number): string {
  return `${value < 0 ? "-" : "+"}${formatCount(Math.abs(value))}`;
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function createProgressReporter(label: string): ((progress: ScanProgress) => void) | undefined {
  if (process.stderr.isTTY !== true) return undefined;

  const minimumVisibleMs = 200;
  const minimumUpdateMs = 80;
  let startedAt = Date.now();
  let lastUpdateAt = 0;
  let visible = false;

  return ({ completedFiles, totalFiles }) => {
    const now = Date.now();
    if (completedFiles === 0) {
      startedAt = now;
      lastUpdateAt = 0;
      visible = false;
      return;
    }

    const complete = completedFiles === totalFiles;
    if (!visible && complete) return;
    if (!visible && now - startedAt < minimumVisibleMs) return;
    if (!complete && now - lastUpdateAt < minimumUpdateMs) return;

    const terminalColumns = process.stderr.columns ?? 80;
    const barWidth = Math.max(10, Math.min(32, terminalColumns - 48));
    const ratio = totalFiles === 0 ? 1 : completedFiles / totalFiles;
    const filledWidth = complete ? barWidth : Math.floor(ratio * barWidth);
    const bar = `${"=".repeat(filledWidth)}${" ".repeat(barWidth - filledWidth)}`;
    const percent = Math.floor(ratio * 100).toString().padStart(3);
    process.stderr.write(
      `\r${CLEAR_LINE}  ${label}  [${bar}] ${percent}%  ${formatCount(completedFiles)}/${formatCount(totalFiles)} files`,
    );
    visible = true;
    lastUpdateAt = now;
    if (complete) process.stderr.write("\n");
  };
}

type FileSourceName = ScanIndex["meta"]["fileSource"];

const FILE_SOURCE_LABELS: Readonly<Record<FileSourceName, string>> = {
  "git-index": "git ls-files",
  "walk-gitignore": "filesystem walk, .gitignore applied",
  "walk-all": "filesystem walk, all files",
  "git-diff": "git diff",
};

function printSummary(index: ScanIndex, maxFileBytes: number): void {
  const { meta } = index;
  const skipped = meta.skippedLargeFiles > 0
    ? `, ${formatCount(meta.skippedLargeFiles)} skipped over ${formatCount(maxFileBytes)} bytes`
    : "";
  const lines: string[] = [`root       ${path.resolve(meta.rootPath)}`];
  const sum = (pick: (file: ScanIndex["files"][number]) => number): number =>
    index.files.reduce((total, file) => total + pick(file), 0);

  if (meta.diff) {
    const addedLines = sum((file) => file.addedLines);
    const removedLines = sum((file) => file.removedLines);
    const addedTokens = sum((file) => file.addedTokens);
    const removedTokens = sum((file) => file.removedTokens);
    const counts = [
      `${formatCount(meta.diff.filesAdded)} added`,
      `${formatCount(meta.diff.filesModified)} modified`,
      `${formatCount(meta.diff.filesDeleted)} deleted`,
      `${formatCount(meta.diff.filesRenamed)} renamed`,
    ];
    lines.push(
      `compare    ${meta.diff.base} -> ${meta.diff.target}`,
      `files      ${formatCount(meta.fileCount)} changed (${counts.join(", ")})${skipped}`,
      `lines      ${formatCount(addedLines + removedLines)} churn (+${formatCount(addedLines)} / -${formatCount(removedLines)}), net ${formatSigned(addedLines - removedLines)}`,
      `tokens     ${formatCount(addedTokens + removedTokens)} churn (+${formatCount(addedTokens)} / -${formatCount(removedTokens)}), net ${formatSigned(addedTokens - removedTokens)} (${meta.tokenizer})`,
    );
    if (meta.diff.cappedFiles > 0) {
      lines.push(`capped     ${formatCount(meta.diff.cappedFiles)} files changed too widely to align, counted as replaced`);
    }
  } else {
    lines.push(
      `files      ${formatCount(meta.fileCount)}${skipped}`,
      `folders    ${formatCount(meta.folderCount)}`,
      `tokens     ${formatCount(sum((file) => file.tokens))} (${meta.tokenizer})`,
    );
  }

  lines.push(
    `scan       ${formatDuration(meta.durationMs)} via ${FILE_SOURCE_LABELS[meta.fileSource]}`,
    `grammars   ${meta.languages.length > 0 ? meta.languages.join(", ") : "none"}`,
  );
  process.stderr.write(`${lines.map((line) => `  ${line}`).join("\n")}\n`);
}

/** Whether the filesystem holds a directory at this path. */
function isDirectory(candidate: string): boolean {
  return statSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true;
}

/**
 * Decide what the positional arguments asked for.
 *
 * `null` means a plain scan, so the caller never has to test the same
 * conditions a second time.
 */
async function readComparisonRequest(
  directory: string, positionals: readonly string[], wantsWorkingTree: boolean, wantsStaged: boolean,
): Promise<ComparisonRequest | null> {
  if (wantsWorkingTree && wantsStaged) fail("--diff and --staged name two different comparisons");
  if (wantsWorkingTree || wantsStaged) {
    if (positionals.length > 0) {
      fail(`${wantsStaged ? "--staged" : "--diff"} already names the comparison, so "${positionals[0]}" has nowhere to go`);
    }
    return parseComparisonSpec([wantsStaged ? "--staged" : "--diff"]);
  }

  if (positionals.length === 0) return null;

  // The directory rule belongs to the command line, which is the only place a
  // folder can occupy the positional slot. Everything after it is the shared
  // spec grammar the page takes as well.
  const only = positionals[0];
  const namesDirectory = positionals.length === 1
    && only !== undefined
    && isDirectory(path.resolve(directory, only));
  if (namesDirectory) return null;

  try {
    const request = parseComparisonSpec(positionals);
    await verifyComparisonRequest(directory, request);
    return request;
  } catch (cause) {
    if (!(cause instanceof GitError)) throw cause;
    fail(positionals.length === 1 && parseRevisionArgument(only!) === null
      ? `no such directory, and not a revision in this repository: ${only}`
      : cause.message);
  }
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        C: { type: "string", short: "C" },
        host: { type: "string" },
        port: { type: "string" },
        dev: { type: "boolean" },
        diff: { type: "boolean" },
        staged: { type: "boolean" },
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

  const workingDirectory = path.resolve(values.C ?? ".");
  if (!isDirectory(workingDirectory)) fail(`no such directory: ${workingDirectory}`);

  const tokenizer = values.tokenizer ?? DEFAULT_TOKENIZER;
  if (!isTokenizerName(tokenizer)) {
    fail(`unknown tokenizer "${tokenizer}". Known tokenizers: ${TOKENIZERS.join(", ")}`);
  }

  const comparisonRequest = await readComparisonRequest(
    workingDirectory, positionals, values.diff === true, values.staged === true,
  );
  if (comparisonRequest !== null && values["all-files"] === true) {
    fail("--all-files widens a filesystem walk, and a diff runs none");
  }

  const maxFileBytes = values["max-file-bytes"] === undefined
    ? DEFAULT_MAX_FILE_BYTES
    : parseIntegerOption("max-file-bytes", values["max-file-bytes"], 1, Number.MAX_SAFE_INTEGER);
  const concurrency = values.concurrency === undefined
    ? DEFAULT_CONCURRENCY
    : parseIntegerOption("concurrency", values.concurrency, 1, 1024);
  const exclude = values.exclude ?? [];

  let producer: IndexProducer;
  if (comparisonRequest === null) {
    const root = path.resolve(workingDirectory, positionals[0] ?? ".");
    if (!isDirectory(root)) fail(`no such directory: ${root}`);
    const onProgress = createProgressReporter("scanning");
    producer = {
      kind: "scan",
      options: {
        root, tokenizer, allFiles: values["all-files"] === true, exclude, maxFileBytes, concurrency,
        ...(onProgress ? { onProgress } : {}),
      } satisfies ScanOptions,
    };
  } else {
    let comparison: Comparison;
    let root: string;
    try {
      root = await repositoryRoot(workingDirectory);
      comparison = await resolveComparison(workingDirectory, comparisonRequest);
    } catch (cause) {
      fail(cause instanceof GitError ? cause.message : String(cause));
    }
    const onProgress = createProgressReporter("comparing");
    producer = {
      kind: "diff",
      options: {
        root, comparison, tokenizer, exclude, maxFileBytes, concurrency,
        ...(onProgress ? { onProgress } : {}),
      } satisfies DiffScanOptions,
    };
  }

  const host = values.host ?? DEFAULT_HOST;
  const port = values.port === undefined ? DEFAULT_PORT : parseIntegerOption("port", values.port, 0, 65535);

  let index: ScanIndex;
  try {
    index = producer.kind === "diff" ? await scanDiff(producer.options) : await scanSourceTree(producer.options);
  } catch (cause) {
    if (cause instanceof GitError) fail(cause.message);
    throw cause;
  }
  printSummary(index, maxFileBytes);

  const server = createSlopsplorerServer({ index, producer, host, port, dev: values.dev === true });
  const address = await server.listen();
  process.stderr.write(`\n  slopsplorer ready on ${address.url}\n\n`);

  const shouldOpenBrowser = values["no-open"] !== true && (values.open === true || values.dev !== true);
  if (shouldOpenBrowser) openInBrowser(address.url);

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
