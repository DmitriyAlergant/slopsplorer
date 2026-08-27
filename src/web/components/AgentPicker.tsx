import { useEffect, useRef, useState } from "react";
import type { AgentTool } from "../../shared/api.ts";
import { MenuChevron } from "./MenuChevron.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  /** Every agent the host found. Never empty: the control is not drawn otherwise. */
  agents: readonly AgentTool[];
  agentId: string;
  /** Choose an agent and ask it, which is what one row of the menu is. */
  onChoose: (agentId: string) => void;
  /** Ask whichever agent is already chosen. */
  onAsk: () => void;
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
        <svg
          viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.2A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z" />
        </svg>
        Ask
        <Tooltip>Ask {chosen.label} about what you are looking at.</Tooltip>
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
              <span className="agent-picker__option-name">{agent.label}</span>
              <span className="agent-picker__option-note">{agent.version}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
