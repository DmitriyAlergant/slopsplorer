import { readFile } from "node:fs/promises";
import type { ProcessResult } from "./process.ts";

/** Everything one ask needs, decided before the process starts. */
export interface AskInvocation {
  /** The brief and the question, as one piece of text. */
  prompt: string;
  /** Directory the agent runs in, which is the scanned root. */
  root: string;
  /** A temporary file an agent that writes its answer to disk is told to use. */
  answerPath: string;
}

/** What an agent answered, and what it says the answer cost. */
export interface AgentAnswer {
  markdown: string;
  /** `null` when the tool reports no cost, which is most of them. */
  costUsd: number | null;
}

/**
 * How to run one agent CLI: prove it is there, prove it is signed in, ask it.
 *
 * One entry per tool and no shared branch, because the tools disagree about
 * every one of those three: where the answer is, what a version line looks
 * like, and what "signed in" is called.
 */
export interface AgentDefinition {
  id: string;
  label: string;
  /** Executable name, resolved on PATH. Never run through a shell. */
  command: string;
  /** Proves the tool is installed, and names the version the menu shows. */
  versionArguments: readonly string[];
  readVersion(result: ProcessResult): string;
  /** Proves the tool can reach a model. A tool that cannot answer is not offered. */
  authArguments: readonly string[];
  isSignedIn(result: ProcessResult): boolean;
  askArguments(invocation: AskInvocation): readonly string[];
  readAnswer(invocation: AskInvocation, result: ProcessResult): Promise<AgentAnswer>;
}

/** First whitespace-separated word: "2.1.247 (Claude Code)". */
function firstWord(text: string): string {
  return text.trim().split(/\s+/)[0] ?? "";
}

/** Last whitespace-separated word: "codex-cli 0.150.1". */
function lastWord(text: string): string {
  const words = text.trim().split(/\s+/);
  return words[words.length - 1] ?? "";
}

/**
 * Remove the escape sequences a tool writes for a terminal.
 *
 * opencode sets the window title on stdout even when stdout is a pipe, so its
 * JSON lines arrive with those sequences in front of them.
 */
function withoutTerminalEscapes(text: string): string {
  return text
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
}

/**
 * Claude Code.
 *
 * `--permission-mode plan` is what makes the run read-only: the reader asked a
 * question about a repository, not for it to be edited. The JSON output carries
 * the answer, the error flag, and the cost in one object, so nothing has to be
 * scraped out of a stream.
 */
const CLAUDE: AgentDefinition = {
  id: "claude",
  label: "Claude Code",
  command: "claude",
  versionArguments: ["--version"],
  readVersion: (result) => firstWord(result.stdout),
  authArguments: ["auth", "status"],
  // The status is JSON, and the one fact needed is one flag. Read by pattern
  // rather than parsed, so a malformed line reports "not signed in" and never
  // throws inside discovery.
  isSignedIn: (result) => result.code === 0 && /"loggedIn"\s*:\s*true/.test(result.stdout),
  askArguments: ({ prompt }) => ["--print", prompt, "--permission-mode", "plan", "--output-format", "json"],
  readAnswer: async (_invocation, result) => {
    const payload: unknown = JSON.parse(result.stdout);
    const report = payload as { result?: unknown; is_error?: unknown; total_cost_usd?: unknown };
    const text = typeof report.result === "string" ? report.result : "";
    if (report.is_error === true) throw new Error(text || "claude reported an error and no message");
    return { markdown: text, costUsd: typeof report.total_cost_usd === "number" ? report.total_cost_usd : null };
  },
};

/**
 * Codex.
 *
 * `--sandbox read-only` is the same decision `--permission-mode plan` is for
 * Claude. The answer is taken from `--output-last-message` rather than from
 * stdout, because stdout is a transcript and the last message is the answer.
 */
const CODEX: AgentDefinition = {
  id: "codex",
  label: "Codex",
  command: "codex",
  versionArguments: ["--version"],
  readVersion: (result) => lastWord(result.stdout),
  authArguments: ["login", "status"],
  isSignedIn: (result) => result.code === 0,
  askArguments: ({ prompt, answerPath }) => [
    "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never",
    "--output-last-message", answerPath, prompt,
  ],
  readAnswer: async ({ answerPath }) => ({ markdown: await readFile(answerPath, "utf8"), costUsd: null }),
};

/**
 * Cursor.
 *
 * `--mode ask` is the read-only mode the tool offers by name, and it is the
 * same decision the other two make with a sandbox or a plan mode. `--trust`
 * answers the workspace prompt that would otherwise stall a headless run in a
 * folder Cursor has not been opened in before; the run still cannot write.
 */
const CURSOR: AgentDefinition = {
  id: "cursor",
  label: "Cursor",
  command: "cursor-agent",
  versionArguments: ["--version"],
  readVersion: (result) => firstWord(result.stdout),
  authArguments: ["status", "--format", "json"],
  isSignedIn: (result) => result.code === 0 && /"isAuthenticated"\s*:\s*true/.test(result.stdout),
  askArguments: ({ prompt }) => ["--print", "--output-format", "text", "--mode", "ask", "--trust", prompt],
  readAnswer: async (_invocation, result) => ({ markdown: result.stdout.trim(), costUsd: null }),
};

/**
 * opencode.
 *
 * It reports no sign-in of its own, so the probe asks what it can answer with:
 * a model list is what a configured provider produces, and an empty one means
 * the tool cannot answer whoever installed it.
 *
 * The answer is assembled from the `text` events of the JSON stream, because
 * the readable output is written for a terminal and carries its escapes. Which
 * tools the `plan` agent may use is opencode's own configuration, so this is
 * the one entry whose read-only run rests on the reader's settings.
 */
const OPENCODE: AgentDefinition = {
  id: "opencode",
  label: "opencode",
  command: "opencode",
  versionArguments: ["--version"],
  readVersion: (result) => firstWord(result.stdout),
  authArguments: ["models"],
  isSignedIn: (result) => result.code === 0 && withoutTerminalEscapes(result.stdout).trim() !== "",
  askArguments: ({ prompt }) => ["run", "--agent", "plan", "--format", "json", prompt],
  readAnswer: async (_invocation, result) => {
    const events = withoutTerminalEscapes(result.stdout)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { type?: unknown; part?: { text?: unknown } });
    const markdown = events
      .filter((event) => event.type === "text")
      .map((event) => (typeof event.part?.text === "string" ? event.part.text : ""))
      .join("");
    return { markdown, costUsd: null };
  },
};

/** The agents the host is searched for, in the order the menu lists them. */
export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [CLAUDE, CODEX, CURSOR, OPENCODE];
