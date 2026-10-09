import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { X } from "lucide-react";

type Size = { width: number; height: number };
const MIN_SIZE: Size = { width: 490, height: 360 };

function clampSize(size: Size): Size {
  return {
    width: Math.round(
      Math.max(MIN_SIZE.width, Math.min(size.width, window.innerWidth - 32)),
    ),
    height: Math.round(
      Math.max(MIN_SIZE.height, Math.min(size.height, window.innerHeight - 48)),
    ),
  };
}
function readSize(key: string): Size | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return Number.isFinite(value?.width) && Number.isFinite(value?.height)
      ? { width: value.width, height: value.height }
      : null;
  } catch {
    return null;
  }
}
function storeSize(key: string, size: Size | null) {
  try {
    if (size) localStorage.setItem(key, JSON.stringify(size));
    else localStorage.removeItem(key);
  } catch {
    // The size is a convenience; the dialog still works without storage.
  }
}

export default function Sheet({
  title,
  description,
  onClose,
  resizeKey,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  /** Lets desktop users resize the dialog, remembered in this browser. */
  resizeKey?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    start: Size;
    last?: Size;
  } | null>(null);
  const [size, setSize] = useState(() =>
    resizeKey ? readSize(resizeKey) : null,
  );
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function current(): Size {
    const rect = ref.current!.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  function resize(next: Size) {
    const clamped = clampSize(next);
    setSize(clamped);
    return clamped;
  }
  function startResize(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, start: current() };
  }
  function moveResize(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active) return;
    // The dialog stays centered, so each edge moves half as far as its size
    // changes; doubling keeps the corner under the pointer.
    active.last = resize({
      width: active.start.width + 2 * (event.clientX - active.x),
      height: active.start.height + 2 * (event.clientY - active.y),
    });
  }
  function endResize() {
    const last = drag.current?.last;
    drag.current = null;
    if (resizeKey && last) storeSize(resizeKey, last);
  }
  function keyResize(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 120 : 40;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!delta || !resizeKey) return;
    event.preventDefault();
    const start = current();
    storeSize(
      resizeKey,
      resize({
        width: start.width + delta[0],
        height: start.height + delta[1],
      }),
    );
  }

  return (
    <dialog
      ref={ref}
      className={`sheet${resizeKey ? " is-resizable" : ""}${size ? " is-resized" : ""}`}
      style={
        size
          ? ({
              "--sheet-width": `${size.width}px`,
              "--sheet-height": `${size.height}px`,
            } as CSSProperties)
          : undefined
      }
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
      {resizeKey && (
        <button
          type="button"
          className="sheet-resize"
          aria-label="Resize dialog"
          title="Drag to resize. Double-click to reset."
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={keyResize}
          onDoubleClick={() => {
            setSize(null);
            storeSize(resizeKey, null);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M14 6 6 14M14 10l-4 4M14 2 2 14" />
          </svg>
        </button>
      )}
    </dialog>
  );
}
