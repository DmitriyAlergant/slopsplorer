import { useEffect, useRef, useState } from "react";
import type { SkillInstallResponse } from "../../shared/api.ts";
import { fetchSkillInstall } from "../api.ts";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Hand the user a command rather than running it.
 *
 * Installing into the user's home directory is their decision to make, and the
 * command is short enough to read before pasting.
 */
export function SkillInstallDialog({ open, onClose }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [install, setInstall] = useState<SkillInstallResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    setCopied(false);
    let cancelled = false;
    fetchSkillInstall()
      .then((loaded) => { if (!cancelled) setInstall(loaded); })
      .catch((cause: unknown) => { if (!cancelled) setFailure(cause instanceof Error ? cause.message : String(cause)); });
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
        <button type="button" className="button button--quiet" onClick={onClose}>Close</button>
      </header>

      <div className="viewer__body viewer__body--prose">
        {failure ? <p className="empty">{failure}</p> : null}
        {!failure && !install ? <p className="empty">Resolving install path</p> : null}
        {install ? (
          <>
            <p>
              This teaches your agent when to reach for Slopsplorer and how to read its output.
              Run the command below in a terminal. Nothing is installed until you do.
            </p>
            <pre className="command"><code>{install.command}</code></pre>
            <button type="button" className="button" onClick={copy}>
              {copied ? "Copied" : "Copy command"}
            </button>
            <dl className="install-facts">
              <div>
                <dt>Installs to</dt>
                <dd><code>{install.targetPath}</code></dd>
              </div>
              <div>
                <dt>Links from</dt>
                <dd><code>{install.linkPath}</code></dd>
              </div>
            </dl>
            <p className="muted">
              The skill lives in the shared <code>~/.agents/skills</code> directory so any agent tool can find it,
              with a symlink into Claude Code's user-level skills directory.
              Re-running the command replaces an earlier copy.
            </p>
          </>
        ) : null}
      </div>
    </dialog>
  );
}
