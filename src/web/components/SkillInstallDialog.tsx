import { useEffect, useState } from "react";
import { useModalDialog } from "../dialog.ts";
import type { SkillInstallResponse } from "../../shared/api.ts";
import { fetchSkillInstall } from "../api.ts";
import { messageOf } from "../format.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  onPreviewSkill: () => void;
}

/**
 * Hand the user a command rather than running it.
 *
 * Installing into the user's home directory is their decision to make, and the
 * command is short enough to read before pasting.
 */
export function SkillInstallDialog({ open, onClose, onPreviewSkill }: Props): React.JSX.Element {
  const dialogRef = useModalDialog(open);
  const [install, setInstall] = useState<SkillInstallResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    let cancelled = false;
    fetchSkillInstall()
      .then((loaded) => { if (!cancelled) setInstall(loaded); })
      .catch((cause: unknown) => { if (!cancelled) setFailure(messageOf(cause)); });
    return () => { cancelled = true; };
  }, [open]);

  const copy = (): void => {
    if (!install) return;
    void navigator.clipboard.writeText(install.command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <dialog ref={dialogRef} className="viewer viewer--narrow" onClose={onClose} onCancel={onClose}>
      <header className="viewer__head">
        <div>
          <p className="eyebrow">Agent skill</p>
          <h2>Install for your coding agent</h2>
        </div>
        <button type="button" className="button" onClick={onClose}>Close</button>
      </header>

      <div className="viewer__body viewer__body--prose">
        {failure ? <p className="empty">{failure}</p> : null}
        {!failure && !install ? <p className="empty">Resolving install path</p> : null}
        {install ? (
          <>
            <p>Run the command below in a terminal.</p>
            <pre className="command"><code>{install.command}</code></pre>
            <div className="install-actions">
              <button type="button" className="button" onClick={copy}>
                {copied ? "Copied" : "Copy command"}
              </button>
              <button type="button" className="link" onClick={onPreviewSkill}>Read SKILL.md</button>
            </div>
            <dl className="install-facts">
              {install.targets.map((target) => (
                <div key={target.path}>
                  <dt>{target.tool}</dt>
                  <dd><code>{target.path}</code></dd>
                </div>
              ))}
            </dl>
            <p className="muted">Re-running the command replaces an earlier copy.</p>
          </>
        ) : null}
      </div>
    </dialog>
  );
}
