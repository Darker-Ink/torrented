import { CheckIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ContextItem = {
  key: string;
  label: string;
  onSelect: () => void;
  checked?: boolean;
  hint?: string;
};

type Props = { at: { x: number; y: number } | null; items: ContextItem[]; onClose: () => void };

/** Right-click menu shown at the cursor, kept inside the viewport. */
const ContextMenu = ({ at, items, onClose }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(null);
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    setPos({
      x: Math.min(at.x, window.innerWidth - w - 8),
      y: Math.min(at.y, window.innerHeight - h - 8),
    });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", onClose);
    };
  }, [at, onClose]);

  if (!at) return null;
  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-50 w-72 animate-fade-in rounded-2xl border border-white/10 bg-neutral-950/85 p-1.5 shadow-2xl shadow-black/70 backdrop-blur-xl"
    >
      {items.map((item) => (
        <button
          key={item.key}
          role="menuitem"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/85 transition hover:bg-white/[0.08] hover:text-white"
        >
          <CheckIcon className={clsx("size-4 shrink-0 text-primary", !item.checked && "invisible")} />
          <span className="flex-1">{item.label}</span>
          {item.hint && <kbd className="font-sans text-xs text-white/40">{item.hint}</kbd>}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
