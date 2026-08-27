import { useEffect, useRef, useState } from "react";
import type { AgentTool } from "../../shared/api.ts";
import { AgentMark } from "./AgentMark.tsx";
import { MenuChevron } from "./MenuChevron.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  /** Every agent the host found. Never empty: the control is not drawn otherwise. */
  agents: readonly AgentTool[];
  agentId: string;
  /** Choose the agent that answers. Choosing one asks nothing by itself. */
  onChoose: (agentId: string) => void;
  /** Ask whichever agent is already chosen. */
  onAsk: () => void;
}

/** What the probe believes about one tool, as the menu says it. */
function signInWord(agent: AgentTool): string {
  return agent.signedIn ? "signed in" : "signed out";
}

/**
 * The agent that answers, and the act of asking it, as one split control.
 *
 * The chevron owns the choice and the wider half owns the act, so the common
 * case is one click and the choice is still one click away. The panel is
 * absolute rather than fixed, so it travels with the button when the page
 * scrolls under it.
 */
export function AgentPicker({ agents, agentId, onChoose, onAsk }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const chosen = agents.find((agent) => agent.id === agentId) ?? agents[0]!;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && groupRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="agent-picker" ref={groupRef}>
      <button type="button" className="agent-picker__ask" onClick={onAsk} {...tooltipHandlers}>
        <AgentMark agentId={chosen.id} />
        Ask
        <Tooltip>
          {chosen.signedIn
            ? `Ask ${chosen.label} about what you are looking at.`
            : `Ask ${chosen.label} about what you are looking at. It reported no sign-in, so the ask can fail.`}
        </Tooltip>
      </button>
      <button
        type="button"
        className="agent-picker__more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose the agent that answers"
        onClick={() => setOpen((shown) => !shown)}
        {...tooltipHandlers}
      >
        <MenuChevron />
        <Tooltip compact>{chosen.label}</Tooltip>
      </button>

      {open ? (
        <div className="agent-picker__panel" role="menu">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="menuitem"
              className="agent-picker__option"
              aria-current={agent.id === chosen.id}
              onClick={() => {
                setOpen(false);
                onChoose(agent.id);
              }}
            >
              <AgentMark agentId={agent.id} size={15} />
              <span className="agent-picker__option-name">{agent.label}</span>
              <span className="agent-picker__option-note" data-signed-in={agent.signedIn}>
                {signInWord(agent)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
