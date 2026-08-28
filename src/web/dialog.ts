import { useEffect, useRef } from "react";

/**
 * Drive a native `<dialog>` from whether it should be showing.
 *
 * A dialog opens and closes itself through methods rather than through a
 * rendered attribute, so its state is pushed into the element. `showModal` on
 * an open dialog throws and `close` on a shut one fires a spurious `close`
 * event, so both calls are guarded. Held here because every dialog on the page
 * needs the same three lines, and one of them forgetting a guard is a fault
 * nothing else would catch.
 */
export function useModalDialog(open: boolean): React.RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);
  return dialogRef;
}
