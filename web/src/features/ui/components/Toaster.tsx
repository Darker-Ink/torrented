import { Transition } from "@headlessui/react";
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useSyncExternalStore } from "react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string; visible: boolean };

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const dismiss = (id: number) => {
  toasts = toasts.map((t) => (t.id === id ? { ...t, visible: false } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 250);
};

const push = (kind: ToastKind, message: string) => {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, kind, message, visible: true }];
  emit();
  setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
};

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const icons = {
  success: <CheckCircleIcon className="size-5 text-success" />,
  error: <ExclamationTriangleIcon className="size-5 text-danger" />,
  info: <InformationCircleIcon className="size-5 text-primary" />,
};

const Toaster = () => {
  const items = useSyncExternalStore(subscribe, () => toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end">
      {items.map((t) => (
        <Transition key={t.id} show={t.visible} appear>
          <div
            className={clsx(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur transition duration-200",
              "data-[closed]:translate-y-2 data-[closed]:opacity-0",
            )}
          >
            {icons[t.kind]}
            <p className="min-w-0 flex-1 text-sm">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="Dismiss">
              <XMarkIcon className="size-4" />
            </button>
          </div>
        </Transition>
      ))}
    </div>
  );
};

export default Toaster;
