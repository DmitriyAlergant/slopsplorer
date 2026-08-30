import { useEffect, useRef, useState } from "react";
import type { OpenInApplication, OpenInOption } from "../../shared/api.ts";
import { MenuChevron } from "./MenuChevron.tsx";
import { OpenInMark } from "./OpenInMark.tsx";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  options: readonly OpenInOption[];
  application: OpenInApplication;
  targetLabel: string;
  opening: OpenInApplication | null;
  onOpen: (application: OpenInApplication) => void;
}

/** Open one folder in a fixed editor or in the host operating system's file manager. */
export function OpenInPicker({ options, application, targetLabel, opening, onOpen }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const primary = options.find(({ id }) => id === application) ?? options[0]!;

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
    <div className="split-picker open-in-picker" ref={groupRef}>
      <button
        type="button"
        className="split-picker__primary"
        disabled={opening !== null}
        onClick={() => onOpen(primary.id)}
        {...tooltipHandlers}
      >
        <OpenInMark application={primary.id} label={primary.label} />
        Open in
        <Tooltip compact singleLine>Open {targetLabel} in {primary.label}</Tooltip>
      </button>
      <button
        type="button"
        className="split-picker__more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose where to open the folder"
        disabled={opening !== null}
        onClick={() => setOpen((shown) => !shown)}
        {...tooltipHandlers}
      >
        <MenuChevron />
        <Tooltip compact singleLine>Choose application</Tooltip>
      </button>

      {open ? (
        <div className="split-picker__panel" role="menu">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className="split-picker__option"
              aria-current={option.id === primary.id}
              onClick={() => {
                setOpen(false);
                onOpen(option.id);
              }}
            >
              <OpenInMark application={option.id} label={option.label} size={17} />
              <span className="split-picker__option-name">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
