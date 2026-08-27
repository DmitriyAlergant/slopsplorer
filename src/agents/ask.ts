import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AskTask } from "../shared/api.ts";
import type { AgentDefinition, AskInvocation } from "./definitions.ts";
import { runCommand, type ProcessResult, type RunningProcess } from "./process.ts";

/** Ceiling on one ask. A tool still thinking after this is stopped and said so. */
const ASK_TIMEOUT_MS = 15 * 60_000;

/** How much of a failing tool's own words are kept, so a message stays readable. */
const MAX_FAILURE_CHARACTERS = 800;

export interface AskInput {
  definition: AgentDefinition;
  /** The question as the reader typed it, kept for the label on the floater. */
  question: string;
  /** Everything the agent is given: the brief and the question, as one text. */
  brief: string;
  /** Directory the agent runs in, which is the scanned root. */
  root: string;
}

export interface AskStore {
  start(input: AskInput): AskTask;
  /** Every ask of this server run, newest first. */
  list(): AskTask[];
  /** Stop it if it runs, and drop it. `false` when no such ask is held. */
  dismiss(id: string): boolean;
  stopAll(): void;
}

interface AskRecord {
  task: AskTask;
  running: RunningProcess;
  answerPath: string;
}

/** Why a run that produced no answer produced none, in the tool's own words. */
function describeFailure(definition: AgentDefinition, result: ProcessResult): string {
  if (result.startFailure !== null) {
    return `${definition.command} could not start: ${result.startFailure}`;
  }
  if (result.timedOut) {
    return `${definition.label} ran past the ${ASK_TIMEOUT_MS / 60_000} minute ceiling and was stopped.`;
  }
  const complaint = result.stderr.trim() || result.stdout.trim();
  if (complaint !== "") return complaint.slice(-MAX_FAILURE_CHARACTERS);
  return `${definition.command} exited with code ${result.code ?? "none"} and said nothing.`;
}

/**
 * The asks of one server run, and the processes behind them.
 *
 * Held in memory and never on disk: an answer describes a scan that only this
 * process holds, so it cannot outlive it.
 */
export function createAskStore(): AskStore {
  const records = new Map<string, AskRecord>();

  const finish = async (id: string, definition: AgentDefinition, invocation: AskInvocation): Promise<void> => {
    const record = records.get(id);
    if (record === undefined) return;
    const result = await record.running.finished;
    // The reader dismissed it while it ran, so there is nobody left to tell.
    if (records.get(id) !== record) return;

    record.task.finishedAt = new Date().toISOString();
    if (result.startFailure === null && result.code === 0) {
      try {
        const answer = await definition.readAnswer(invocation, result);
        if (answer.markdown.trim() === "") {
          // A clean exit with nothing to show is a failure the reader has to
          // see, not an empty panel they are left to interpret.
          record.task.state = "failed";
          record.task.failure = `${definition.label} finished and said nothing.`;
        } else {
          record.task.state = "answered";
          record.task.answer = answer.markdown;
          record.task.costUsd = answer.costUsd;
        }
      } catch (cause) {
        // The tool succeeded and its answer was still unreadable, which the
        // reader has to be told rather than left waiting for.
        record.task.state = "failed";
        record.task.failure = `${definition.label} finished, and its answer could not be read: `
          + (cause instanceof Error ? cause.message : String(cause));
      }
    } else {
      record.task.state = "failed";
      record.task.failure = describeFailure(definition, result);
    }
    await rm(record.answerPath, { force: true });
  };

  return {
    start({ definition, question, brief, root }) {
      const id = randomUUID();
      const answerPath = path.join(os.tmpdir(), `slopsplorer-ask-${id}.md`);
      const invocation: AskInvocation = { prompt: brief, root, answerPath };
      const running = runCommand(
        definition.command, definition.askArguments(invocation), { cwd: root, timeoutMs: ASK_TIMEOUT_MS },
      );
      const task: AskTask = {
        id,
        agentId: definition.id,
        agentLabel: definition.label,
        question,
        brief,
        state: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        answer: null,
        failure: null,
        costUsd: null,
      };
      records.set(id, { task, running, answerPath });
      void finish(id, definition, invocation);
      return { ...task };
    },

    list() {
      return [...records.values()].map((record) => ({ ...record.task })).reverse();
    },

    dismiss(id) {
      const record = records.get(id);
      if (record === undefined) return false;
      records.delete(id);
      record.running.stop();
      void rm(record.answerPath, { force: true });
      return true;
    },

    stopAll() {
      for (const record of records.values()) record.running.stop();
      records.clear();
    },
  };
}
