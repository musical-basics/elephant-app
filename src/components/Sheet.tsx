import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export default function Sheet({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(event) => {
        // Keep drafts open until the user chooses a dialog action.
        event.preventDefault();
      }}
      aria-labelledby="sheet-title"
      aria-describedby={description ? "sheet-description" : undefined}
    >
      <section className="sheet-inner">
        <div className="sheet-handle" />
        <header className="sheet-heading">
          <h2 id="sheet-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        {description && (
          <p className="sheet-description" id="sheet-description">
            {description}
          </p>
        )}
        {children}
      </section>
    </dialog>
  );
}
