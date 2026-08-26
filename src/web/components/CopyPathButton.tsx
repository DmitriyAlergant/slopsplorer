import { useEffect, useId, useState } from "react";
import { Tooltip, tooltipHandlers } from "./Tooltip.tsx";

interface Props {
  path: string;
}

/** Copy a project-relative path with the same compact affordance used beside folder names. */
export function CopyPathButton({ path }: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const tooltipId = useId();

  useEffect(() => {
    setCopied(false);
  }, [path]);

  const copyPath = (): void => {
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <button
      type="button"
      className="detail__tool detail__tool--copy"
      onClick={copyPath}
      {...tooltipHandlers}
      aria-label={copied ? `Copied ${path}` : `Copy project-relative path ${path}`}
      aria-describedby={tooltipId}
    >
      <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
        {copied ? (
          <path d="m4 10.5 4 4 8-9" />
        ) : (
          <>
            <rect x="7" y="7" width="9.5" height="9.5" rx="1.8" />
            <path d="M4.6 12.5H4A1.5 1.5 0 0 1 2.5 11V5A1.5 1.5 0 0 1 4 3.5h6A1.5 1.5 0 0 1 11.5 5v.6" />
          </>
        )}
      </svg>
      <Tooltip id={tooltipId} compact>{copied ? "Copied" : "Copy project path"}</Tooltip>
    </button>
  );
}
