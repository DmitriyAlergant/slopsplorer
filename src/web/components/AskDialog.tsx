import { useEffect, useRef, useState } from "react";
import type { AgentTool } from "../../shared/api.ts";

interface Props {
  open: boolean;
  /** The agent that will answer. It is chosen by the control that opened this. */
  agent: AgentTool;
  /** An ask is already being started, so a second Enter must not start another. */
  starting: boolean;
  failure: string | null;
  onClose: () => void;
  onAsk: (question: string) => void;
}

/**
 * Ask one of the local agents about what is on the page.
 *
 * The question is the only thing typed here. What the reader is looking at -
 * the comparison, the drill, the selection, the unit, the last file opened -
 * is added by the server, so the brief cannot describe a page state the
 * browser has since left.
 */
export function AskDialog({ open, agent, starting, failure, onClose, onAsk }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    // Emptied when the panel opens rather than when it is sent, so an ask that
    // fails to start leaves the reader their question.
    setQuestion("");
    questionRef.current?.focus();
  }, [open]);

  const submit = (): void => {
    if (starting) return;
    onAsk(question);
  };

  return (
    <dialog ref={dialogRef} className="viewer viewer--narrow ask" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">{agent.label} {agent.version}</p>
          <h2>Ask about what you are looking at</h2>
        </div>
        <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
      </header>

      <div className="viewer__body viewer__body--prose">
        <label className="visually-hidden" htmlFor="ask-question">Your question</label>
        <textarea
          ref={questionRef}
          id="ask-question"
          className="ask__question"
          rows={5}
          value={question}
          placeholder="What would you like to know about this code?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />

        <p className="muted">
          The agent is also told what you have on screen: the subject, the drill, the selection,
          the unit, the flavors counted, and the last file you opened. It reads the repository and
          changes nothing. Leave the question empty to be told what you are looking at.
        </p>

        {failure ? <p className="empty">{failure}</p> : null}

        <div className="install-actions">
          <button type="button" className="button button--primary" onClick={submit} disabled={starting}>
            {starting ? "Starting" : "Ask"}
          </button>
          <span className="muted">Cmd or Ctrl and Enter</span>
        </div>
      </div>
    </dialog>
  );
}
