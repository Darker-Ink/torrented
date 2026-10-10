import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { CheckIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import type { ReactNode } from "react";

type Option = { value: string; label: string; hint?: string };

type Props = {
  icon: ReactNode;
  label: string;
  title: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
};

const TrackMenu = ({ icon, label, title, value, options, onChange }: Props) => (
  <Popover className="relative">
    <PopoverButton
      className="grid size-10 place-items-center rounded-full text-white/90 transition hover:bg-white/10 hover:text-white focus:outline-none"
      aria-label={label}
      title={label}
    >
      {icon}
    </PopoverButton>
    <PopoverPanel
      anchor="top end"
      transition
      className="z-50 mb-3 w-64 rounded-lg border border-white/10 bg-black/90 p-1.5 shadow-2xl backdrop-blur-md transition data-[closed]:translate-y-1 data-[closed]:opacity-0"
    >
      {({ close }) => (
        <>
          <p className="px-2.5 pt-1.5 pb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">{title}</p>
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={clsx(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-white/10",
                o.value === value ? "text-white" : "text-white/70",
              )}
            >
              <CheckIcon className={clsx("size-4 shrink-0 text-primary", o.value !== value && "invisible")} />
              <span className="min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-white/45">{o.hint}</span>}
              </span>
            </button>
          ))}
        </>
      )}
    </PopoverPanel>
  </Popover>
);

export default TrackMenu;
