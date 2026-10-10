import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";

const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play or pause"],
  ["← / →", "Back or forward 10 seconds"],
  ["J / L", "Back or forward 10 seconds"],
  ["↑ / ↓", "Volume up or down"],
  ["M", "Mute"],
  ["C", "Captions on or off"],
  ["F", "Fullscreen"],
  ["P", "Picture-in-picture"],
  ["N", "Next episode"],
  ["Shift + > / <", "Faster or slower"],
  ["0 – 9", "Jump to 0% – 90%"],
  ["I", "Stats for nerds"],
  ["?", "This list"],
];

type Props = { open: boolean; onClose: () => void };

const ShortcutsDialog = ({ open, onClose }: Props) => (
  <Dialog open={open} onClose={onClose} className="relative z-50">
    <DialogBackdrop transition className="fixed inset-0 bg-black/60 transition data-[closed]:opacity-0" />
    <div className="fixed inset-0 grid place-items-center p-4">
      <DialogPanel
        transition
        className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950/90 p-6 text-white shadow-2xl backdrop-blur-xl transition data-[closed]:scale-95 data-[closed]:opacity-0"
      >
        <DialogTitle className="mb-4 text-lg font-semibold">Keyboard shortcuts</DialogTitle>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded-md bg-white/10 px-2 py-0.5 font-sans text-xs font-semibold">{keys}</kbd>
              </dt>
              <dd className="text-white/75">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogPanel>
    </div>
  </Dialog>
);

export default ShortcutsDialog;
