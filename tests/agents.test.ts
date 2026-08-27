import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAskStore } from "../src/agents/ask.ts";
import { AGENT_DEFINITIONS, type AgentDefinition } from "../src/agents/definitions.ts";
import { discoverAgents } from "../src/agents/discover.ts";
import type { ProcessResult } from "../src/agents/process.ts";
import { pathOutsidePackageBins, runCommand } from "../src/agents/process.ts";
import type { AskTask } from "../src/shared/api.ts";
import { MARKED_AGENT_IDS } from "../src/web/components/AgentMark.tsx";

const RUN_TIMEOUT_MS = 20_000;

let workingRoot: string;

beforeAll(async () => {
  workingRoot = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-agents-"));
});

afterAll(async () => {
  await rm(workingRoot, { recursive: true, force: true });
});

function definitionOf(id: string): AgentDefinition {
  const found = AGENT_DEFINITIONS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no agent definition named ${id}`);
  return found;
}

function resultOf(partial: Partial<ProcessResult>): ProcessResult {
  return { code: 0, stdout: "", stderr: "", startFailure: null, timedOut: false, ...partial };
}

/** An agent that is this Node, so a test can prove the shape without a model. */
function fakeAgent(id: string, script: string, options: {
  versionScript?: string;
  authExitCode?: number;
  command?: string;
} = {}): AgentDefinition {
  return {
    id,
    label: `Fake ${id}`,
    command: options.command ?? process.execPath,
    versionArguments: ["-e", options.versionScript ?? "process.stdout.write('fake 9.9.9')"],
    readVersion: (result) => result.stdout.trim().split(/\s+/)[1] ?? "",
    authArguments: ["-e", `process.exit(${options.authExitCode ?? 0})`],
    isSignedIn: (result) => result.code === 0,
    askArguments: ({ prompt, answerPath }) => ["-e", script, prompt, answerPath],
    readAnswer: async ({ answerPath }) => ({ markdown: await readFile(answerPath, "utf8"), costUsd: null }),
  };
}

/** The prompt is argv[1] and the answer file argv[2], as `askArguments` passes them. */
const ANSWER_SCRIPT = `
  const [prompt, answerPath] = process.argv.slice(1);
  require("node:fs").writeFileSync(answerPath, "# Answer\\n\\n" + prompt.slice(0, 20));
`;

const REFUSE_SCRIPT = `process.stderr.write("the agent refused"); process.exit(3);`;

const HANG_SCRIPT = `setInterval(() => {}, 1000);`;

/**
 * An agent that runs a tool of its own, the way a real one does. The child pid
 * lands in the answer file, so a test can ask whether stopping the ask stopped
 * what the agent started.
 */
const SPAWN_CHILD_SCRIPT = `
  const [, answerPath] = process.argv.slice(1);
  const child = require("node:child_process").spawn(
    process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" },
  );
  require("node:fs").writeFileSync(answerPath, String(child.pid));
  setInterval(() => {}, 1000);
`;

/** Whether a process id still names a live process. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(what);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function settled(list: () => AskTask[], id: string): Promise<AskTask> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    const task = list().find((candidate) => candidate.id === id);
    if (task === undefined) throw new Error("the ask left the store");
    if (task.state !== "running") return task;
    if (Date.now() > deadline) throw new Error("the ask never finished");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("the agent definitions", () => {
  it("asks Claude in a mode that cannot write, and reads its JSON result", async () => {
    const claude = definitionOf("claude");
    const argv = claude.askArguments({ prompt: "why is this heavy?", root: "/tmp", answerPath: "/tmp/a.md" });
    expect(argv).toContain("--permission-mode");
    expect(argv).toContain("plan");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("json");
    expect(argv).toContain("why is this heavy?");

    const answer = await claude.readAnswer(
      { prompt: "", root: "/tmp", answerPath: "/tmp/a.md" },
      resultOf({ stdout: JSON.stringify({ result: "# Heavy\n", is_error: false, total_cost_usd: 0.25 }) }),
    );
    expect(answer).toEqual({ markdown: "# Heavy\n", costUsd: 0.25 });
  });

  it("reports a Claude run that failed, rather than answering with its message", async () => {
    const claude = definitionOf("claude");
    await expect(claude.readAnswer(
      { prompt: "", root: "/tmp", answerPath: "/tmp/a.md" },
      resultOf({ stdout: JSON.stringify({ result: "credit balance is too low", is_error: true }) }),
    )).rejects.toThrow("credit balance is too low");
  });

  it("reads sign-in from what each tool reports", () => {
    const claude = definitionOf("claude");
    expect(claude.isSignedIn(resultOf({ stdout: '{\n  "loggedIn": true\n}' }))).toBe(true);
    expect(claude.isSignedIn(resultOf({ stdout: '{\n  "loggedIn": false\n}' }))).toBe(false);
    expect(claude.isSignedIn(resultOf({ code: 1, stdout: '{"loggedIn": true}' }))).toBe(false);
    expect(claude.readVersion(resultOf({ stdout: "2.1.247 (Claude Code)\n" }))).toBe("2.1.247");

    const codex = definitionOf("codex");
    expect(codex.isSignedIn(resultOf({ code: 0 }))).toBe(true);
    expect(codex.isSignedIn(resultOf({ code: 1 }))).toBe(false);
    expect(codex.readVersion(resultOf({ stdout: "codex-cli 0.150.1\n" }))).toBe("0.150.1");
  });

  it("asks Codex in a sandbox that cannot write, and takes the last message from a file", async () => {
    const codex = definitionOf("codex");
    const answerPath = path.join(workingRoot, "codex-answer.md");
    const argv = codex.askArguments({ prompt: "what changed?", root: workingRoot, answerPath });
    expect(argv.slice(0, 4)).toEqual(["exec", "--sandbox", "read-only", "--skip-git-repo-check"]);
    expect(argv).toContain(answerPath);
    expect(argv[argv.length - 1]).toBe("what changed?");

    await writeFile(answerPath, "# From the file\n", "utf8");
    const answer = await codex.readAnswer({ prompt: "", root: workingRoot, answerPath }, resultOf({}));
    expect(answer).toEqual({ markdown: "# From the file\n", costUsd: null });
  });
});

describe("the agent definitions, continued", () => {
  it("asks Cursor in its read-only ask mode, and takes the answer from stdout", async () => {
    const cursor = definitionOf("cursor");
    const argv = cursor.askArguments({ prompt: "what is here?", root: "/tmp", answerPath: "/tmp/a.md" });
    expect(argv).toContain("--print");
    expect(argv).toContain("--mode");
    expect(argv).toContain("ask");
    expect(argv[argv.length - 1]).toBe("what is here?");

    expect(cursor.isSignedIn(resultOf({ stdout: '{\n  "isAuthenticated": true\n}' }))).toBe(true);
    expect(cursor.isSignedIn(resultOf({ stdout: '{\n  "isAuthenticated": false\n}' }))).toBe(false);
    expect(cursor.readVersion(resultOf({ stdout: "2026.08.25-3e8eec8\n" }))).toBe("2026.08.25-3e8eec8");

    const answer = await cursor.readAnswer(
      { prompt: "", root: "/tmp", answerPath: "/tmp/a.md" }, resultOf({ stdout: "# Here\n\nA point.\n" }),
    );
    expect(answer).toEqual({ markdown: "# Here\n\nA point.", costUsd: null });
  });

  it("asks opencode as its plan agent, and joins the text events of the stream", async () => {
    const opencode = definitionOf("opencode");
    const argv = opencode.askArguments({ prompt: "what is here?", root: "/tmp", answerPath: "/tmp/a.md" });
    expect(argv.slice(0, 5)).toEqual(["run", "--agent", "plan", "--format", "json"]);
    expect(argv[argv.length - 1]).toBe("what is here?");

    // opencode sets the window title on stdout even when stdout is a pipe, so
    // the stream it writes carries terminal escapes in front of its JSON.
    const title = "\u001B]0;project: ready\u0007";
    const stream = [
      `${title}{"type":"step_start","part":{}}`,
      '{"type":"text","part":{"text":"# Here\\n\\n"}}',
      '{"type":"text","part":{"text":"A point."}}',
      '{"type":"step_finish","part":{"cost":0}}',
      "",
    ].join("\n");
    const answer = await opencode.readAnswer(
      { prompt: "", root: "/tmp", answerPath: "/tmp/a.md" }, resultOf({ stdout: stream }),
    );
    expect(answer).toEqual({ markdown: "# Here\n\nA point.", costUsd: null });

    expect(opencode.isSignedIn(resultOf({ stdout: `${title}opencode/some-model\n` }))).toBe(true);
    expect(opencode.isSignedIn(resultOf({ stdout: title }))).toBe(false);
    expect(opencode.readVersion(resultOf({ stdout: "1.18.3\n" }))).toBe("1.18.3");
  });
});

describe("the marks the menu draws", () => {
  it("has one for every agent that can be offered", () => {
    expect([...MARKED_AGENT_IDS].sort()).toEqual(AGENT_DEFINITIONS.map((definition) => definition.id).sort());
  });
});

describe("discovering what this host can run", () => {
  it("offers a tool that is installed and signed in", async () => {
    const found = await discoverAgents([fakeAgent("present", ANSWER_SCRIPT)], workingRoot);
    expect(found.map((agent) => [agent.definition.id, agent.version, agent.signedIn]))
      .toEqual([["present", "9.9.9", true]]);
  });

  it("leaves out a tool that is not installed", async () => {
    const missing = fakeAgent("absent", ANSWER_SCRIPT, { command: "slopsplorer-no-such-agent" });
    expect(await discoverAgents([missing], workingRoot)).toEqual([]);
  });

  it("offers a tool that is installed and signed out, and says so", async () => {
    const signedOut = fakeAgent("signed-out", ANSWER_SCRIPT, { authExitCode: 1 });
    const found = await discoverAgents([signedOut], workingRoot);
    expect(found.map((agent) => [agent.definition.id, agent.signedIn])).toEqual([["signed-out", false]]);
  });
});

describe("the asks of one server run", () => {
  it("hands the brief to the agent and keeps its answer", async () => {
    const store = createAskStore();
    const task = store.start({
      definition: fakeAgent("answering", ANSWER_SCRIPT),
      question: "what is heavy?",
      brief: "The brief, then the question.",
      root: workingRoot,
    });
    expect(task.state).toBe("running");
    expect(store.list().map((held) => held.id)).toEqual([task.id]);

    const finished = await settled(() => store.list(), task.id);
    expect(finished.state).toBe("answered");
    expect(finished.answer).toBe("# Answer\n\nThe brief, then the ");
    expect(finished.failure).toBeNull();
    expect(finished.finishedAt).not.toBeNull();
    store.stopAll();
  });

  it("reports an agent that exited cleanly and said nothing", async () => {
    const store = createAskStore();
    const task = store.start({
      definition: fakeAgent("silent", `require("node:fs").writeFileSync(process.argv[2], "  \\n");`),
      question: "",
      brief: "brief",
      root: workingRoot,
    });
    const finished = await settled(() => store.list(), task.id);
    expect(finished.state).toBe("failed");
    expect(finished.failure).toContain("said nothing");
    expect(finished.answer).toBeNull();
    store.stopAll();
  });

  it("reports what a refusing agent said instead of an empty answer", async () => {
    const store = createAskStore();
    const task = store.start({
      definition: fakeAgent("refusing", REFUSE_SCRIPT),
      question: "",
      brief: "brief",
      root: workingRoot,
    });
    const finished = await settled(() => store.list(), task.id);
    expect(finished.state).toBe("failed");
    expect(finished.failure).toBe("the agent refused");
    expect(finished.answer).toBeNull();
    store.stopAll();
  });

  it("stops a running agent when the ask is dismissed, and drops it", async () => {
    const store = createAskStore();
    const task = store.start({
      definition: fakeAgent("hanging", HANG_SCRIPT),
      question: "",
      brief: "brief",
      root: workingRoot,
    });
    expect(store.dismiss(task.id)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.dismiss(task.id)).toBe(false);
  });

  it("stops the tools the agent itself started", async () => {
    const store = createAskStore();
    const answerFile = path.join(workingRoot, "child-pid.txt");
    const task = store.start({
      definition: {
        ...fakeAgent("spawner", SPAWN_CHILD_SCRIPT),
        askArguments: ({ prompt }) => ["-e", SPAWN_CHILD_SCRIPT, prompt, answerFile],
      },
      question: "",
      brief: "brief",
      root: workingRoot,
    });

    let childPid = 0;
    await waitFor(async () => {
      const written = await readFile(answerFile, "utf8").catch(() => "");
      childPid = Number(written.trim());
      return Number.isInteger(childPid) && childPid > 0;
    }, "the agent never started a tool of its own");

    store.dismiss(task.id);
    await waitFor(() => !alive(childPid), "the tool the agent started outlived the ask");
  });

  it("lists the newest ask first", async () => {
    const store = createAskStore();
    const first = store.start({
      definition: fakeAgent("first", ANSWER_SCRIPT), question: "one", brief: "b", root: workingRoot,
    });
    const second = store.start({
      definition: fakeAgent("second", ANSWER_SCRIPT), question: "two", brief: "b", root: workingRoot,
    });
    expect(store.list().map((task) => task.id)).toEqual([second.id, first.id]);
    store.stopAll();
  });
});

describe("finding the agent the person installed", () => {
  it("drops the package bin folders npm puts in front of PATH", () => {
    const injected = [
      "/Users/reader/node_modules/.bin",
      "/Users/reader/work/app/node_modules/.bin",
      "/Users/reader/.local/bin",
      "/usr/local/bin",
    ].join(path.delimiter);
    expect(pathOutsidePackageBins(injected)).toBe(
      ["/Users/reader/.local/bin", "/usr/local/bin"].join(path.delimiter),
    );
  });

  it("leaves a PATH that npm never touched alone", () => {
    const plain = ["/Users/reader/.local/bin", "/usr/bin"].join(path.delimiter);
    expect(pathOutsidePackageBins(plain)).toBe(plain);
  });
});

describe("running one command", () => {
  it("passes an argument that looks like a shell command as one argument", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", "; rm -rf / && echo $HOME"],
      { cwd: workingRoot, timeoutMs: RUN_TIMEOUT_MS },
    ).finished;
    expect(result.stdout).toBe("; rm -rf / && echo $HOME");
    expect(result.code).toBe(0);
  });

  it("says why a command that cannot start did not run", async () => {
    const result = await runCommand("slopsplorer-no-such-command", [], {
      cwd: workingRoot, timeoutMs: RUN_TIMEOUT_MS,
    }).finished;
    expect(result.startFailure).not.toBeNull();
    expect(result.code).toBeNull();
  });

  it("stops a command that runs past its ceiling, and says that is why", async () => {
    const result = await runCommand(process.execPath, ["-e", HANG_SCRIPT], {
      cwd: workingRoot, timeoutMs: 150,
    }).finished;
    expect(result.timedOut).toBe(true);
  });
});
