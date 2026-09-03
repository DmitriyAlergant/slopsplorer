#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { AGENT_DEFINITIONS } from "./agents/definitions.ts";
import { discoverAgents, type AvailableAgent } from "./agents/discover.ts";
import { scanDiff, type DiffScanOptions } from "./scanner/diffScan.ts";
import {
  fetchPullRequest, GitError, parseComparisonSpec, parsePullRequestUrl, parseRevisionArgument, pullRequestBacklink,
  repositoryRoot, resolveComparison, verifyComparisonRequest,
  type Comparison, type PullRequestLocation,
} from "./scanner/gitdiff.ts";
import { DEFAULT_MAX_FILE_BYTES, scanSourceTree } from "./scanner/scan.ts";
import type { ScanIndex, ScanOptions, ScanProgress } from "./scanner/scan.ts";
import { buildSpine } from "./scanner/spine.ts";
import { ASPECTS, type Aspect, type ComparisonRequest } from "./shared/api.ts";
import { DEFAULT_TOKENIZER, isTokenizerName, TOKENIZERS } from "./scanner/tokenize.ts";
import { buildReport, DEFAULT_REPORT_THRESHOLD, REPORT_UNITS, type ReportOptions } from "./server/report.ts";
import { snapshotReproductionCommand, writeStaticBundle } from "./server/export.ts";
import {
  createSlopsplorerServer, isAddressInUse, MAX_TCP_PORT, resolvePackageRoot,
  type IndexProducer, type ServerAddress, type SlopsplorerServer,
} from "./server/server.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;

/** How far the default port may walk forward past listeners a previous run left behind. */
const DEFAULT_PORT_ATTEMPTS = 20;

/** Reading is IO-bound, so oversubscribing the core count is deliberate. */
const DEFAULT_CONCURRENCY = Math.max(4, os.availableParallelism());

/** Erase the whole progress line, so a shorter update cannot leave a tail behind. */
const CLEAR_LINE = "\u001B[2K";

/** Colour only where a person reads it: a pipe and NO_COLOR both get plain text. */
const useColor = process.stderr.isTTY === true && process.env["NO_COLOR"] === undefined;

function yellow(text: string): string {
  return useColor ? `\u001B[33m${text}\u001B[0m` : text;
}

function boldYellow(text: string): string {
  return useColor ? `\u001B[1;33m${text}\u001B[0m` : text;
}

const USAGE = `slopsplorer - local, token-weighted source tree explorer.

USAGE
  slopsplorer [<dir>] [options]           Scan a source tree. Default: current folder.
  slopsplorer --diff [options]            Compare HEAD against the working tree,
                                          untracked files included.
  slopsplorer --staged [options]          Compare HEAD against the index.
  slopsplorer <rev> [options]             Compare <rev> against the working tree.
  slopsplorer <commit> [options]          A pasted object name is that commit alone,
                                          against its parent.
  slopsplorer <rev>^! [options]           That commit alone, whatever names it.
  slopsplorer <revA> <revB> [options]     Compare <revA> against <revB>.
  slopsplorer <revA>..<revB> [options]    The same, written as a range.
  slopsplorer <revA>...<revB> [options]   Compare the merge base of A and B against B.
  slopsplorer --pr <number> [options]     Review a pull request. Fetches it from the
                                          remote first, so it reaches one whose branch
                                          was deleted after a squash merge. Needs gh
                                          or glab signed in.
  slopsplorer <pull request URL>          The same, named by the page you were reading.

  A single positional is read as a directory if a directory exists at that path,
  otherwise as a revision. A named revision, such as a branch or HEAD~5, is a
  place to measure from. A raw object name is one commit, because that is what a
  commit pasted from a log or a review page means.

OPTIONS
  -C <dir>                Run as if started in <dir>. A comparison uses this to
                          locate the repository.
  --pr <number|URL>       Fetch a pull request and compare it against the commit it
                          was written against. Needs gh (GitHub) or glab (GitLab)
                          installed and signed in: only the forge knows which
                          branch a request is against. A URL naming a project no
                          remote here serves is cloned to a read-only temporary
                          folder, removed when the run ends, so a review can start
                          from anywhere.
  --host <address>        Interface to bind. Default ${DEFAULT_HOST}.
  --port <number>         Port to bind. Use 0 for any free port. Default ${DEFAULT_PORT},
                          which walks forward to the next free port when it is
                          busy. A port named here is used or the run fails.
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
  --export <dir>          Write a complete static explorer to a missing or empty
                          directory, then exit. Includes source previews.
  -h, --help              Show this help.
  --version               Show the version.

REPORT
  --report                Print a text report to stdout and exit. No server.
  --unit <name>           Unit of the report: ${Object.keys(REPORT_UNITS).join(", ")}. Default tokens.
  --aspect <name>         Side of the change the report describes: ${ASPECTS.join(", ")}.
                          Default churn. Comparison only.
  --threshold <percent>   A node is expanded when it reaches this share of its
                          section. Default ${DEFAULT_REPORT_THRESHOLD}.

EXAMPLES
  slopsplorer .                   Scan the current folder. The same with no argument.
  slopsplorer --report            Print a text report of the current folder.
  slopsplorer --report --diff     Print a text report of the working-tree change.
  slopsplorer --export ./site     Export the current folder as a static snapshot.
  slopsplorer --export ./review main...HEAD
                                  Export a comparison as a static snapshot.
  slopsplorer ../other-project    Scan a folder elsewhere.
  slopsplorer --diff              Compare HEAD against the working tree.
  slopsplorer --staged            Compare HEAD against the index.
  slopsplorer main...HEAD         Compare the merge base of main and HEAD to HEAD.
  slopsplorer HEAD~5              Compare HEAD~5 against the working tree.
  slopsplorer origin/main         All work since origin/main, uncommitted included.
  slopsplorer f53f4f9eb           Just that commit, against its parent.
  slopsplorer origin/main^!       Just the commit origin/main points at.
  slopsplorer -C ~/src/app v1 v2  Compare two revisions of a repository elsewhere.
  slopsplorer --pr 619            Review pull request 619 of the origin remote.
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

interface PortHolder {
  port: number;
  pid: number;
  command: string;
}

/**
 * Which processes listen on these ports.
 *
 * Best effort by design: `lsof` is absent on Windows and in some containers, and
 * a hint about a busy port is never a reason to refuse to serve one.
 */
async function findPortHolders(ports: readonly number[]): Promise<PortHolder[]> {
  const holders: PortHolder[] = [];
  for (const port of ports) {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "pc"]));
    } catch {
      // No lsof, or nothing listens there any more. Either way there is nothing to name.
      continue;
    }
    // One record per process: `p<pid>` opens it and `c<command>` names it.
    let pid: number | null = null;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("c") && pid !== null) {
        holders.push({ port, pid, command: line.slice(1) });
        pid = null;
      }
    }
  }
  return holders;
}

/** The ports the search stepped over, which are exactly the busy ones. */
function rangeOfPorts(from: number, until: number): number[] {
  const ports: number[] = [];
  for (let port = from; port < until; port += 1) ports.push(port);
  return ports;
}

/**
 * Say who holds the ports this run could not take, and how to reclaim them.
 *
 * The kill command covers the Node processes only. Another program on the port
 * is named but not offered up, because it is not something this tool left behind.
 */
async function writeBusyPortNotice(ports: readonly number[], servingOn: number | null): Promise<void> {
  const busy = ports.join(", ");
  const headline = servingOn === null
    ? `port ${busy} is in use`
    : `${ports.length === 1 ? "port" : "ports"} ${busy} in use, serving on ${servingOn} instead`;
  const lines = [yellow(`  ${headline}`)];

  const holders = await findPortHolders(ports);
  const commandWidth = Math.max(0, ...holders.map((holder) => holder.command.length));
  for (const holder of holders) {
    lines.push(yellow(`    ${holder.port}  ${holder.command.padEnd(commandWidth)}  pid ${holder.pid}`));
  }
  const nodePids = holders.filter((holder) => holder.command === "node").map((holder) => holder.pid);
  if (nodePids.length > 0) {
    lines.push(`  ${yellow("to reclaim:")} ${boldYellow(`kill ${nodePids.join(" ")}`)}`);
  }
  process.stderr.write(`\n${lines.join("\n")}\n`);
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
  "git-tree": "git tree",
  "walk-gitignore": "filesystem walk, .gitignore applied",
  "walk-all": "filesystem walk, all files",
  "git-diff": "git diff",
};

function printSummary(index: ScanIndex, maxFileBytes: number, agents: readonly AvailableAgent[]): void {
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
    `agents     ${agents.length > 0
      ? agents.map((agent) => `${agent.definition.command} ${agent.version}${agent.signedIn ? "" : " (signed out)"}`).join(", ")
      : "none installed"}`,
  );
  process.stderr.write(`${lines.map((line) => `  ${line}`).join("\n")}\n`);
}

/** Whether the filesystem holds a directory at this path. */
function isDirectory(candidate: string): boolean {
  return statSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** A pull request named by number, or by the URL of its page. */
function pullRequestLocation(argument: string): PullRequestLocation {
  const fromUrl = parsePullRequestUrl(argument);
  if (fromUrl !== null) return fromUrl;
  if (!/^\d+$/.test(argument)) {
    fail(`--pr expects a pull request number or the URL of its page, got "${argument}"`);
  }
  return { number: Number(argument), project: null };
}

/** A comparison, and the repository it is resolved and measured in. */
interface ComparisonPlan {
  request: ComparisonRequest;
  directory: string;
}

/**
 * Fetch a pull request and say what was fetched.
 *
 * Naming a pull request is the consent to reach the network for it, so this
 * runs only from `--pr` or a pull request URL, and never from a revision the
 * repository happens not to hold.
 */
async function openPullRequest(directory: string, argument: string): Promise<ComparisonPlan> {
  const location = pullRequestLocation(argument);
  const project = location.project === null ? "" : ` ${location.project.host}/${location.project.webPath}`;
  try {
    const fetched = await fetchPullRequest(directory, location);
    if (fetched.temporaryClone !== null) {
      process.stderr.write(
        `  pull request ${fetched.number}: no remote here serves${project}, so it was cloned to\n`
        + `  ${fetched.directory}, which is read-only and is removed when this run ends\n`,
      );
    }
    process.stderr.write(
      `  pull request ${fetched.number}: fetched ${fetched.remoteRef} from ${fetched.remote}, `
      + `against ${fetched.baseBranch}\n`,
    );
    return { request: fetched.request, directory: fetched.directory };
  } catch (cause) {
    fail(cause instanceof GitError ? cause.message : String(cause));
  }
}

/**
 * Decide what the positional arguments asked for.
 *
 * `null` means a plain scan, so the caller never has to test the same
 * conditions a second time.
 */
async function readComparisonRequest(
  directory: string,
  positionals: readonly string[],
  wantsWorkingTree: boolean,
  wantsStaged: boolean,
  pullRequest: string | undefined,
): Promise<ComparisonPlan | null> {
  if (wantsWorkingTree && wantsStaged) fail("--diff and --staged name two different comparisons");
  if (pullRequest !== undefined) {
    if (wantsWorkingTree || wantsStaged) fail("--pr already names the comparison");
    if (positionals.length > 0) {
      fail(`--pr already names the comparison, so "${positionals[0]}" has nowhere to go`);
    }
    return openPullRequest(directory, pullRequest);
  }
  if (wantsWorkingTree || wantsStaged) {
    if (positionals.length > 0) {
      fail(`${wantsStaged ? "--staged" : "--diff"} already names the comparison, so "${positionals[0]}" has nowhere to go`);
    }
    return { request: parseComparisonSpec([wantsStaged ? "--staged" : "--diff"]), directory };
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

  // A pull request page is a place a reviewer already has in their hand, and it
  // names a change no revision in this repository may hold yet.
  if (positionals.length === 1 && parsePullRequestUrl(only!) !== null) {
    return openPullRequest(directory, only!);
  }

  try {
    const request = parseComparisonSpec(positionals);
    await verifyComparisonRequest(directory, request);
    return { request, directory };
  } catch (cause) {
    if (!(cause instanceof GitError)) throw cause;
    fail(positionals.length === 1 && parseRevisionArgument(only!) === null
      ? `no such directory, and not a revision in this repository: ${only}`
      : cause.message);
  }
}

interface ReportFlags {
  report?: boolean | undefined;
  unit?: string | undefined;
  aspect?: string | undefined;
  threshold?: string | undefined;
  host?: string | undefined;
  port?: string | undefined;
  dev?: boolean | undefined;
  open?: boolean | undefined;
}

/**
 * The report's options, or `null` when the run serves the page instead.
 *
 * A report flag without `--report` and a server flag with it are both
 * refused, so a flag never silently does nothing.
 */
function readReportOptions(values: ReportFlags, isDiff: boolean): ReportOptions | null {
  if (values.report !== true) {
    for (const flag of ["unit", "aspect", "threshold"] as const) {
      if (values[flag] !== undefined) fail(`--${flag} describes a report, so it needs --report`);
    }
    return null;
  }
  for (const flag of ["host", "port", "dev", "open"] as const) {
    if (values[flag] !== undefined) fail(`--${flag} belongs to the server, and --report starts none`);
  }

  const unitName = values.unit ?? "tokens";
  const measure = REPORT_UNITS[unitName];
  if (measure === undefined) fail(`unknown unit "${unitName}". Known units: ${Object.keys(REPORT_UNITS).join(", ")}`);

  if (values.aspect !== undefined && !isDiff) fail("--aspect names a side of a change, and a scan has none");
  // A scan has one content, so its report is the after-image, which is no side
  // a comparison offers and therefore no flag a reader can name.
  let aspect: Aspect = "after";
  if (isDiff) {
    const aspectName = values.aspect ?? "churn";
    const named = ASPECTS.find((candidate) => candidate === aspectName);
    if (named === undefined) fail(`unknown aspect "${aspectName}". Known aspects: ${ASPECTS.join(", ")}`);
    aspect = named;
  }

  const threshold = values.threshold === undefined ? DEFAULT_REPORT_THRESHOLD : Number(values.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    fail(`--threshold expects a percent between 0 and 100, got "${values.threshold}"`);
  }

  return { measure, aspect, threshold };
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
        pr: { type: "string" },
        "all-files": { type: "boolean" },
        exclude: { type: "string", multiple: true },
        tokenizer: { type: "string" },
        "max-file-bytes": { type: "string" },
        concurrency: { type: "string" },
        open: { type: "boolean" },
        // parseArgs has no negation syntax, so the opt-out is its own flag.
        "no-open": { type: "boolean" },
        export: { type: "string" },
        report: { type: "boolean" },
        unit: { type: "string" },
        aspect: { type: "string" },
        threshold: { type: "string" },
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

  const exportDirectory = values.export === undefined ? null : path.resolve(workingDirectory, values.export);
  const backlinkArgument = exportDirectory === null
    ? undefined
    : values.pr ?? (positionals.length === 1 ? positionals[0] : undefined);
  const exportBacklink = backlinkArgument === undefined ? null : pullRequestBacklink(backlinkArgument);

  if (exportDirectory !== null) {
    if (values.report === true) fail("--report and --export name two different output modes");
    for (const flag of ["host", "port", "dev", "open", "no-open"] as const) {
      if (values[flag] !== undefined) fail(`--${flag} belongs to the server, and --export starts none`);
    }
    for (const flag of ["unit", "aspect", "threshold"] as const) {
      if (values[flag] !== undefined) fail(`--${flag} describes a report, and --export writes the explorer`);
    }
    const snapshotEntry = path.join(resolvePackageRoot(), "dist", "web", "snapshot.html");
    if (statSync(snapshotEntry, { throwIfNoEntry: false })?.isFile() !== true) {
      fail("static client assets are missing. Run `npm run build` first");
    }
  }

  const tokenizer = values.tokenizer ?? DEFAULT_TOKENIZER;
  if (!isTokenizerName(tokenizer)) {
    fail(`unknown tokenizer "${tokenizer}". Known tokenizers: ${TOKENIZERS.join(", ")}`);
  }

  // Installed before anything reaches the network or the temporary directory,
  // so a Ctrl-C during a scan runs the exit listeners a Ctrl-C on the page does.
  let activeServer: SlopsplorerServer | null = null;
  let shuttingDown = false;
  const shutDown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const closed = activeServer === null ? Promise.resolve() : activeServer.close();
    closed.then(() => process.exit(0), () => process.exit(0));
  };
  process.on("SIGINT", shutDown);
  process.on("SIGTERM", shutDown);

  const comparisonPlan = await readComparisonRequest(
    workingDirectory, positionals, values.diff === true, values.staged === true, values.pr,
  );
  if (comparisonPlan !== null && values["all-files"] === true) {
    fail("--all-files widens a filesystem walk, and a diff runs none");
  }
  const reportOptions = readReportOptions(values, comparisonPlan !== null);

  const maxFileBytes = values["max-file-bytes"] === undefined
    ? DEFAULT_MAX_FILE_BYTES
    : parseIntegerOption("max-file-bytes", values["max-file-bytes"], 1, Number.MAX_SAFE_INTEGER);
  const concurrency = values.concurrency === undefined
    ? DEFAULT_CONCURRENCY
    : parseIntegerOption("concurrency", values.concurrency, 1, 1024);
  const exclude = values.exclude ?? [];

  let producer: IndexProducer;
  if (comparisonPlan === null) {
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
      root = await repositoryRoot(comparisonPlan.directory);
      comparison = await resolveComparison(comparisonPlan.directory, comparisonPlan.request);
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
  const port = values.port === undefined ? DEFAULT_PORT : parseIntegerOption("port", values.port, 0, MAX_TCP_PORT);

  let index: ScanIndex;
  try {
    index = producer.kind === "diff" ? await scanDiff(producer.options) : await scanSourceTree(producer.options);
  } catch (cause) {
    if (cause instanceof GitError) fail(cause.message);
    throw cause;
  }
  if (reportOptions !== null) {
    process.stdout.write(buildReport(index, reportOptions));
    return;
  }
  if (exportDirectory !== null) {
    process.stderr.write(`  exporting the complete accepted source to ${exportDirectory}\n`);
    try {
      const spine = producer.kind === "diff"
        ? await buildSpine(producer.options, producer.options.comparison.request)
        : null;
      const onProgress = createProgressReporter("exporting");
      await writeStaticBundle({
        clientRoot: path.join(resolvePackageRoot(), "dist", "web"),
        output: exportDirectory,
        index,
        producer: producer.kind === "diff"
          ? { kind: "diff", options: producer.options }
          : { kind: "scan", root: producer.options.root },
        spine,
        concurrency,
        backlink: exportBacklink,
        reproductionCommand: snapshotReproductionCommand(process.argv.slice(2), index.meta.rootName),
        ...(onProgress ? { onProgress } : {}),
      });
    } catch (cause) {
      fail(`static export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    process.stderr.write(
      "  serve the folder over HTTP to read it, for example `npx --yes http-server . -p 8080`\n"
      + "  a file:// address cannot load the modules, the worker, and the data the page needs\n",
    );
    process.stdout.write(`${exportDirectory}\n`);
    return;
  }
  // Asked of the tools themselves, and only for a run that serves a page: a
  // report has nobody to offer an agent to.
  const agents = await discoverAgents(AGENT_DEFINITIONS, workingDirectory);
  printSummary(index, maxFileBytes, agents);

  // A port the user named is used or the run fails. The default one walks forward,
  // because a listener a previous run left behind is not a reason to stop.
  const portAttempts = values.port === undefined ? DEFAULT_PORT_ATTEMPTS : 1;
  const server = createSlopsplorerServer({
    index, producer, host, port, portAttempts, dev: values.dev === true, agents,
  });
  activeServer = server;
  let address: ServerAddress;
  try {
    address = await server.listen();
  } catch (cause) {
    if (!isAddressInUse(cause)) throw cause;
    await writeBusyPortNotice([port], null);
    fail(`port ${port} is in use. Choose another with --port, or drop --port to take the next free one.`);
  }
  // Port 0 asked the operating system to choose, so a different port is the answer, not a move.
  if (port !== 0 && address.port !== port) {
    await writeBusyPortNotice(rangeOfPorts(port, address.port), address.port);
  }
  process.stderr.write(`\n  slopsplorer ready on ${address.url}\n\n`);

  const shouldOpenBrowser = values["no-open"] !== true && (values.open === true || values.dev !== true);
  if (shouldOpenBrowser) openInBrowser(address.url);
}

await main();
