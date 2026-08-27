import { useEffect, useState } from "react";
import type { AskTask } from "../../shared/api.ts";
import { duration } from "../format.ts";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  tasks: readonly AskTask[];
  onOpen: (task: AskTask) => void;
  onDismiss: (id: string) => void;
}

/** How long the task has run, or how long it took. */
function lengthOf(task: AskTask, now: number): string {
  const end = task.finishedAt === null ? now : new Date(task.finishedAt).getTime();
  return duration(end - new Date(task.startedAt).getTime());
}

/** What a chip says it is: the question, or the subject when none was typed. */
function labelOf(task: AskTask): string {
  return task.question.trim() === "" ? "What am I looking at" : task.question.trim();
}

const STATE_WORDS: Readonly<Record<AskTask["state"], string>> = {
  running: "Thinking",
  answered: "Ready",
  failed: "Failed",
};

/**
 * The asks of this visit, stacked over the page.
 *
 * An ask takes minutes, so it cannot hold the page still while it runs. Each
 * one keeps a chip here until the reader dismisses it, and a finished chip
 * opens the answer. Dismissing one that still runs stops the agent, because
 * the only reason to keep it running is to read what it says.
 */
export function AskDock({ tasks, onOpen, onDismiss }: Props): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  const running = tasks.some((task) => task.state === "running");

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (tasks.length === 0) return null;

  return (
    <aside className="dock" aria-label="Agent questions">
      {tasks.map((task) => (
        <div key={task.id} className="dock__task" data-state={task.state}>
          <button
            type="button"
            className="dock__open"
            onClick={() => onOpen(task)}
            aria-label={`${STATE_WORDS[task.state]}: ${labelOf(task)}`}
            {...tooltipHandlers}
          >
            <span className="dock__mark" aria-hidden="true">
              {task.state === "running" ? <span className="dock__spinner" /> : null}
              {task.state === "answered" ? "✓" : null}
              {task.state === "failed" ? "!" : null}
            </span>
            <span className="dock__copy">
              <span className="dock__question">{labelOf(task)}</span>
              <span className="dock__meta">
                {task.agentLabel} · {STATE_WORDS[task.state]} · {lengthOf(task, now)}
              </span>
            </span>
            <Tooltip>{labelOf(task)}</Tooltip>
          </button>
          <button
            type="button"
            className="dock__dismiss"
            onClick={() => onDismiss(task.id)}
            aria-label={task.state === "running" ? "Stop and dismiss" : "Dismiss"}
            {...tooltipHandlers}
          >
            ✕
            <Tooltip compact>{task.state === "running" ? "Stop and dismiss" : "Dismiss"}</Tooltip>
          </button>
        </div>
      ))}
    </aside>
  );
}
