import { useEffect, useRef, useState } from "react";
import type { AskTask } from "../../shared/api.ts";
import { duration } from "../format.ts";
import { renderMarkdown } from "../markdown.tsx";

interface Props {
  task: AskTask | null;
  onClose: () => void;
}

/** What the run took, and what it cost when the tool says. */
function describeRun(task: AskTask): string {
  const parts = [task.agentLabel];
  if (task.finishedAt !== null) {
    parts.push(duration(new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()));
  }
  if (task.costUsd !== null) parts.push(`$${task.costUsd.toFixed(2)}`);
  return parts.join(" · ");
}

/**
 * One agent's answer, drawn from its Markdown.
 *
 * The brief sits under the answer rather than above it, because the reader
 * wrote the question and knows what they asked. It is there so that what the
 * agent was told is never a thing they have to take on trust.
 */
export function AnswerDialog({ task, onClose }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (task === null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    setCopied(false);
  }, [task]);

  /**
   * Copy the question with the answer, and not the brief.
   *
   * There is no second turn here, so a follow-up is asked afresh. What carries
   * over is what the reader wrote and what came back; the brief describes the
   * page as it was, and the next ask writes its own.
   */
  const copy = (): void => {
    if (task?.answer == null) return;
    const question = task.question.trim();
    const text = question === "" ? task.answer : `${question}\n\n${task.answer}`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <dialog ref={dialogRef} className="viewer viewer--answer" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">{task ? describeRun(task) : "Answer"}</p>
          <h2>{task && task.question.trim() !== "" ? task.question.trim() : "What am I looking at"}</h2>
        </div>
        <div className="viewer__actions">
          {task?.answer != null ? (
            <button type="button" className="button button--quiet" onClick={copy}>
              {copied ? "Copied" : "Copy question and answer"}
            </button>
          ) : null}
          <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="viewer__body viewer__body--prose">
        {task?.state === "running" ? <p className="empty">{task.agentLabel} is still reading the repository.</p> : null}
        {task?.state === "failed" ? <pre className="answer__failure">{task.failure}</pre> : null}
        {task?.answer != null ? <div className="answer">{renderMarkdown(task.answer)}</div> : null}
        {task ? (
          <details className="answer__brief">
            <summary>What the agent was told</summary>
            <pre>{task.brief}</pre>
          </details>
        ) : null}
      </div>
    </dialog>
  );
}
