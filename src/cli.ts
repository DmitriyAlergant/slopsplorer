#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { scanDiff, type DiffScanOptions } from "./scanner/diffScan.ts";
import {
  GitError, isRevision, parseRevisionArgument, repositoryRoot, resolveComparison,
  type Comparison, type ComparisonRequest,
} from "./scanner/gitdiff.ts";
import { DEFAULT_MAX_FILE_BYTES, scanSourceTree } from "./scanner/scan.ts";
import type { ScanIndex, ScanOptions, ScanProgress } from "./scanner/scan.ts";
import { DEFAULT_TOKENIZER, isTokenizerName, TOKENIZERS } from "./scanner/tokenize.ts";
import { createSlopsplorerServer, resolvePackageRoot, type IndexProducer } from "./server/server.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;

/** Reading is IO-bound, so oversubscribing the core count is deliberate. */
const DEFAULT_CONCURRENCY = Math.max(4, os.availableParallelism());

/** Erase the whole progress line, so a shorter update cannot leave a tail behind. */
const CLEAR_LINE = "\u001B[2K";

const USAGE = `slopsplorer - local, token-weighted source tree explorer.

Scan mode answers how much of a repository an agent must read. Diff mode answers
the neighbouring question: how much of a change a reviewer must read, and where
it sits. Both draw the same map.

USAGE
  slopsplorer [<dir>] [options]           Map a source tree. Default: this folder.
  slopsplorer --diff [options]            Map HEAD against the working tree,
                                          untracked files included.
  slopsplorer --staged [options]          Map HEAD against the index.
  slopsplorer <rev> [options]             Map <rev> against the working tree.
  slopsplorer <revA> <revB> [options]     Map <revA> against <revB>.
  slopsplorer <revA>..<revB> [options]    The same, written as a range.
  slopsplorer <revA>...<revB> [options]   Map the merge base of A and B against B.

  A lone positional is a directory when the filesystem holds one at that path,
  and a revision otherwise. A branch named like a folder therefore needs no
  escape syntax.

OPTIONS
  -C <dir>                Run as if started in <dir>. This is how diff mode names
                          its repository, because the positional slot holds the
                          revisions.
  --host <address>        Interface to bind. Default ${DEFAULT_HOST}.
  --port <number>         Port to bind. Use 0 for any free port. Default ${DEFAULT_PORT}.
  --dev                   Serve the client through Vite with hot reload on the same port.
  --all-files             Ignore Git and .gitignore. Built-in directory exclusions
                          still apply. Scan mode only: a diff runs no walk to widen.
  --exclude <dir>         Skip a directory name anywhere in the tree. Repeatable.
                          Applies to both modes.
  --tokenizer <name>      One of ${TOKENIZERS.join(", ")}. Default ${DEFAULT_TOKENIZER}.
  --max-file-bytes <n>    Skip files larger than this. Default ${DEFAULT_MAX_FILE_BYTES} bytes.
                          In diff mode either side over the ceiling skips the file.
  --concurrency <n>       Files measured in parallel. Default ${DEFAULT_CONCURRENCY} on this machine.
  --open                  Open the URL in the default browser when the scan finishes.
                          This is the default outside --dev.
  --no-open               Do not open a browser.
  -h, --help              Show this help.
  --version               Show the version.

IN THE PAGE
  The numbers heading of the source tree picks the unit: tokens, lines, or LOC.
  In diff mode it also picks the side - what the change added, what it removed,
  their sum (churn), their difference (net, signed), or the whole after-image.

EXAMPLES
  slopsplorer                       Map the current folder.
  slopsplorer ../other-project      Map a folder elsewhere.
  slopsplorer --diff                Where does my uncommitted work sit?
  slopsplorer --staged              The same for what is staged.
  slopsplorer main...HEAD           Where this branch sits, as a pull request shows it.
  slopsplorer HEAD~5                What the last five commits touched.
  slopsplorer -C ~/src/app v1.4 v1.5
                                    Compare two tags of a repository elsewhere.
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
    return wantsStaged ? { kind: "staged" } : { kind: "workingTree" };
  }

  if (positionals.length === 0) return null;
  if (positionals.length > 2) fail(`expected at most two revisions, got ${positionals.length}`);

  const verify = async (candidate: string): Promise<void> => {
    if (!(await isRevision(directory, candidate))) fail(`not a revision in this repository: ${candidate}`);
  };

  if (positionals.length === 2) {
    const [base, target] = positionals as [string, string];
    await verify(base);
    await verify(target);
    return { kind: "revisionPair", base, target };
  }

  const only = positionals[0]!;
  if (isDirectory(path.resolve(directory, only))) return null;
  const range = parseRevisionArgument(only);
  if (range !== null) {
    await verify(range.base);
    await verify(range.target);
    return range;
  }
  if (await isRevision(directory, only)) return { kind: "revisionToWorkingTree", rev: only };
  fail(`no such directory, and not a revision in this repository: ${only}`);
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
