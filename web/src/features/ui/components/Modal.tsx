import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
  footer?: ReactNode;
  bare?: boolean;
};

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

const Modal = ({ open, onClose, title, description, size = "md", children, footer, bare }: Props) => (
  <Dialog open={open} onClose={onClose} className="relative z-50">
    <DialogBackdrop
      transition
      className="fixed inset-0 bg-black/70 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0"
    />
    <div className="fixed inset-0 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <DialogPanel
          transition
          className={clsx(
            "relative w-full overflow-hidden rounded-xl border border-line bg-bg-raised shadow-2xl shadow-black/60 transition duration-200 data-[closed]:translate-y-3 data-[closed]:scale-[0.98] data-[closed]:opacity-0",
            sizes[size],
          )}
        >
          {bare ? (
            children
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 px-6 pt-5">
                <div className="space-y-1">
                  {title && <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>}
                  {description && <p className="text-sm text-muted">{description}</p>}
                </div>
                <button
                  onClick={onClose}
                  className="-mr-2 rounded-md p-1.5 text-muted transition hover:bg-white/5 hover:text-fg"
                  aria-label="Close"
                >
                  <XMarkIcon className="size-5" />
                </button>
              </div>
              <div className="px-6 py-5">{children}</div>
              {footer && (
                <div className="flex items-center justify-end gap-2 border-t border-line bg-black/20 px-6 py-4">
                  {footer}
                </div>
              )}
            </>
          )}
        </DialogPanel>
      </div>
    </div>
  </Dialog>
);

export default Modal;
