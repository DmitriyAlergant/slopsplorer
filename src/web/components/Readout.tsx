import type { FigureSign } from "../format.ts";

interface Props {
  /** What the figure is, in as few words as the page can name it. */
  label: string;
  value: string;
  /** The figure the surrounding controls currently select. */
  emphasis?: boolean;
  sign?: FigureSign;
}

/**
 * One figure over its name.
 *
 * Every summary on the page is built from these, so the scope strip, the
 * folder head, and any future readout state their figures in one shape and at
 * one rhythm rather than each inventing a sentence of its own.
 */
export function Readout({ label, value, emphasis = false, sign = "none" }: Props): React.JSX.Element {
  return (
    <div className="readout" data-emphasis={emphasis} data-sign={sign}>
      <span className="readout__value">{value}</span>
      <span className="readout__label">{label}</span>
    </div>
  );
}
