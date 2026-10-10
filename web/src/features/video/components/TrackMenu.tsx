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

export const controlButton =
  "grid size-11 place-items-center rounded-full text-white/85 transition hover:scale-110 hover:text-white focus:outline-none data-[focus]:ring-2 data-[focus]:ring-primary/70";

export const glassPanel =
  "z-50 rounded-2xl border border-white/10 bg-neutral-950/80 shadow-2xl shadow-black/70 backdrop-blur-xl transition data-[closed]:translate-y-1 data-[closed]:opacity-0";

const TrackMenu = ({ icon, label, title, value, options, onChange }: Props) => (
  <Popover className="relative">
    <PopoverButton className={clsx(controlButton, "data-[open]:text-primary")} aria-label={label} title={label}>
      {icon}
    </PopoverButton>
    <PopoverPanel anchor={{ to: "top end", gap: 12 }} transition className={clsx(glassPanel, "w-72 p-2")}>
      {({ close }) => (
        <>
          <p className="px-3 pt-2 pb-2.5 text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">{title}</p>
          <div className="max-h-80 overflow-y-auto">
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] transition hover:bg-white/[0.08]",
                  o.value === value ? "text-white" : "text-white/65",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-white/40">{o.hint}</span>}
                </span>
                <CheckIcon className={clsx("size-5 shrink-0 text-primary", o.value !== value && "invisible")} />
              </button>
            ))}
          </div>
        </>
      )}
    </PopoverPanel>
  </Popover>
);

export default TrackMenu;
