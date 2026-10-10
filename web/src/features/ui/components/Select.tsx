import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import type { ReactNode } from "react";

export type Option<T> = { value: T; label: ReactNode; description?: ReactNode };

type Props<T> = {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
  buttonClassName?: string;
  placeholder?: string;
  anchor?: "bottom start" | "bottom end";
};

const Select = <T extends string | number | null>({
  value,
  onChange,
  options,
  className,
  buttonClassName,
  placeholder = "Select…",
  anchor = "bottom start",
}: Props<T>) => {
  const current = options.find((o) => o.value === value);
  return (
    <Listbox value={value} onChange={onChange}>
      <div className={clsx("relative", className)}>
        <ListboxButton
          className={clsx(
            "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-line bg-white/[0.04] pr-2 pl-3 text-left text-sm transition hover:bg-white/[0.07] focus:outline-none data-[focus]:border-primary/60",
            buttonClassName,
          )}
        >
          <span className={clsx("truncate", !current && "text-subtle")}>{current?.label ?? placeholder}</span>
          <ChevronUpDownIcon className="size-4 shrink-0 text-muted" />
        </ListboxButton>
        <ListboxOptions
          anchor={anchor}
          transition
          className="z-50 mt-1 max-h-72 w-(--button-width) min-w-44 overflow-auto rounded-lg border border-line bg-surface p-1 shadow-xl shadow-black/50 transition duration-100 [--anchor-gap:4px] focus:outline-none data-[closed]:opacity-0"
        >
          {options.map((o) => (
            <ListboxOption
              key={String(o.value)}
              value={o.value}
              className="group flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm select-none data-[focus]:bg-white/[0.07]"
            >
              <CheckIcon className="invisible mt-0.5 size-4 shrink-0 text-primary group-data-[selected]:visible" />
              <div className="min-w-0">
                <div className="truncate">{o.label}</div>
                {o.description && <div className="text-xs text-muted">{o.description}</div>}
              </div>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
};

export default Select;
