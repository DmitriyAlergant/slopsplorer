import { useState } from "react";
import { useModalDialog } from "../dialog.ts";

interface Props {
  open: boolean;
  command: string;
  onClose: () => void;
}

/** Explain why a frozen index cannot open a different commit span. */
export function StaticSpineDialog({ open, command, onClose }: Props): React.JSX.Element {
  const dialogRef = useModalDialog(open);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <dialog ref={dialogRef} className="viewer viewer--narrow" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">Static snapshot</p>
          <h2>Slice commits locally</h2>
        </div>
        <button type="button" className="button" onClick={onClose}>Close</button>
      </header>

      <div className="viewer__body viewer__body--prose">
        <p>Slicing by commit spans is only possible in a local Slopsplorer scan.</p>
        <pre className="command"><code>{command}</code></pre>
        <div className="install-actions">
          <button type="button" className="button" onClick={copy}>
            {copied ? "Copied" : "Copy command"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
