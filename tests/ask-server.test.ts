import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentDefinition } from "../src/agents/definitions.ts";
import type { AvailableAgent } from "../src/agents/discover.ts";
import { scanDiff, type DiffScanOptions } from "../src/scanner/diffScan.ts";
import { resolveComparison } from "../src/scanner/gitdiff.ts";
import { createSlopsplorerServer, type SlopsplorerServer } from "../src/server/server.ts";
import type { AgentsResponse, AskListResponse, AskTask, ViewRequest } from "../src/shared/api.ts";

const execFileAsync = promisify(execFile);
const SCAN_TIMEOUT_MS = 60_000;
const ANSWER_TIMEOUT_MS = 20_000;

let root: string;
let server: SlopsplorerServer;
let serverUrl: string;

/** The prompt reaches the answer file, so a test can read what the agent was told. */
const ECHO_BRIEF = `
  const [prompt, answerPath] = process.argv.slice(1);
  require("node:fs").writeFileSync(answerPath, "# Echo\\n\\n" + prompt);
`;

const ECHO_AGENT: AgentDefinition = {
  id: "echo",
  label: "Echo",
  command: process.execPath,
  versionArguments: ["-e", ""],
  readVersion: () => "0.0.1",
  authArguments: ["-e", ""],
  isSignedIn: () => true,
  askArguments: ({ prompt, answerPath }) => ["-e", ECHO_BRIEF, prompt, answerPath],
  readAnswer: async ({ answerPath }) => ({ markdown: await readFile(answerPath, "utf8"), costUsd: null }),
};

const AGENTS: AvailableAgent[] = [{ definition: ECHO_AGENT, version: "0.0.1" }];

const VIEW: Partial<ViewRequest> = { kinds: ["code", "test", "text", "i18n", "data", "other"] };

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout;
}

async function postJson(route: string, body: unknown): Promise<Response> {
  return fetch(`${serverUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listAsks(): Promise<AskTask[]> {
  const response = await fetch(`${serverUrl}/api/asks`);
  return ((await response.json()) as AskListResponse).tasks;
}

/** Wait for one ask to leave the running state, the way the page's poll does. */
async function settled(id: string): Promise<AskTask> {
  const deadline = Date.now() + ANSWER_TIMEOUT_MS;
  for (;;) {
    const task = (await listAsks()).find((candidate) => candidate.id === id);
    if (task === undefined) throw new Error("the ask left the list");
    if (task.state !== "running") return task;
    if (Date.now() > deadline) throw new Error("the ask never finished");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "slopsplorer-ask-server-"));
  await git("init", "-q", "-b", "main");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "first.ts"), "export const first = 1;\n", "utf8");
  await git("add", "-A");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-m", "first");
  await writeFile(path.join(root, "src", "second.ts"), "export const second = 2;\n", "utf8");
  await git("add", "-A");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-m", "second");

  const options: DiffScanOptions = {
    root,
    comparison: await resolveComparison(root, { kind: "revisionPair", base: "HEAD~1", target: "HEAD" }),
    tokenizer: "o200k_base",
    exclude: [],
    maxFileBytes: 2 * 1024 * 1024,
    concurrency: 4,
  };
  server = createSlopsplorerServer({
    index: await scanDiff(options),
    producer: { kind: "diff", options },
    host: "127.0.0.1",
    port: 0,
    portAttempts: 1,
    agents: AGENTS,
  });
  const address = await server.listen();
  serverUrl = address.url;
}, SCAN_TIMEOUT_MS);

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe("asking a local agent through the server", () => {
  it("offers only the agents the host was found able to run", async () => {
    const response = await fetch(`${serverUrl}/api/agents`);
    expect(response.status).toBe(200);
    expect((await response.json()) as AgentsResponse).toEqual({
      agents: [{ id: "echo", label: "Echo", version: "0.0.1" }],
    });
  });

  it("hands the agent a brief that names the comparison and the question", async () => {
    const started = await postJson("/api/ask", {
      agentId: "echo",
      question: "What did this change?",
      view: VIEW,
      lastViewedPath: "src/second.ts",
    });
    expect(started.status).toBe(200);
    const task = (await started.json()) as AskTask;
    expect(task.state).toBe("running");
    expect(task.agentLabel).toBe("Echo");
    expect(task.brief).toContain("Subject: a comparison of ");
    expect(task.brief).toContain("Last file they opened: src/second.ts");
    expect(task.brief).toContain("What did this change?");

    const finished = await settled(task.id);
    expect(finished.state).toBe("answered");
    // The agent writes back what it was given, so the answer proves the brief
    // reached the process and not only the task.
    expect(finished.answer).toContain("What did this change?");
    expect(finished.costUsd).toBeNull();
  });

  it("refuses an agent this host does not offer", async () => {
    const response = await postJson("/api/ask", { agentId: "not-installed", question: "hi", view: VIEW });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("not-installed");
  });

  it("refuses a body with no question", async () => {
    const response = await postJson("/api/ask", { agentId: "echo", view: VIEW });
    expect(response.status).toBe(400);
  });

  it("drops an ask that is dismissed, and says what is left", async () => {
    const started = await postJson("/api/ask", { agentId: "echo", question: "second", view: VIEW });
    const task = (await started.json()) as AskTask;
    await settled(task.id);

    const dismissed = await postJson("/api/ask-dismiss", { id: task.id });
    expect(dismissed.status).toBe(200);
    const remaining = ((await dismissed.json()) as AskListResponse).tasks;
    expect(remaining.some((held) => held.id === task.id)).toBe(false);
  });

  it("refuses a dismissal that names nothing", async () => {
    expect((await postJson("/api/ask-dismiss", {})).status).toBe(400);
  });
});
