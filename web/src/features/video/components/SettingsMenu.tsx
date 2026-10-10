import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { CheckIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { ChevronLeftGlyph, ChevronRightGlyph, GearGlyph } from "./PlayerIcons";
import { controlButton, glassPanel } from "./styles";

export type Choice = { value: string; label: string; hint?: string };

export type SettingsPage = {
  key: string;
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
};

export type SettingsToggle = { key: string; label: string; checked: boolean; onChange: (checked: boolean) => void };

type Props = { pages: SettingsPage[]; toggles: SettingsToggle[] };

const Row = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] text-white/85 transition hover:bg-white/[0.08] hover:text-white"
  >
    {children}
  </button>
);

const Switch = ({ on }: { on: boolean }) => (
  <span className={clsx("relative h-5 w-9 shrink-0 rounded-full transition", on ? "bg-primary" : "bg-white/25")}>
    <span
      className={clsx(
        "absolute top-0.5 size-4 rounded-full bg-white shadow transition",
        on ? "left-[18px]" : "left-0.5",
      )}
    />
  </span>
);

/** YouTube-style settings: a list of options, each opening its own page. */
const SettingsMenu = ({ pages, toggles }: Props) => {
  const [open, setOpen] = useState<string | null>(null);
  const page = pages.find((p) => p.key === open);

  return (
    <Popover className="relative">
      <PopoverButton
        className={clsx(controlButton, "data-[open]:rotate-45 data-[open]:text-primary")}
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen(null)}
      >
        <GearGlyph className="size-7" />
      </PopoverButton>
      <PopoverPanel anchor={{ to: "top end", gap: 12 }} transition className={clsx(glassPanel, "w-80 p-2")}>
        {({ close }) =>
          page ? (
            <div>
              <button
                onClick={() => setOpen(null)}
                className="flex w-full items-center gap-2 border-b border-white/10 px-2 pt-1 pb-2.5 text-left text-[15px] font-semibold"
              >
                <ChevronLeftGlyph className="size-5" />
                {page.label}
              </button>
              <div className="max-h-80 overflow-y-auto pt-1.5">
                {page.choices.map((c) => (
                  <Row
                    key={c.value}
                    onClick={() => {
                      page.onChange(c.value);
                      setOpen(null);
                      close();
                    }}
                  >
                    <CheckIcon className={clsx("size-5 shrink-0 text-primary", c.value !== page.value && "invisible")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.label}</span>
                      {c.hint && <span className="block truncate text-xs text-white/40">{c.hint}</span>}
                    </span>
                  </Row>
                ))}
              </div>
            </div>
          ) : (
            <div>
              {pages.map((p) => (
                <Row key={p.key} onClick={() => setOpen(p.key)}>
                  <span className="flex-1">{p.label}</span>
                  <span className="max-w-32 truncate text-sm text-white/55">
                    {p.choices.find((c) => c.value === p.value)?.label ?? ""}
                  </span>
                  <ChevronRightGlyph className="size-4 shrink-0 text-white/40" />
                </Row>
              ))}
              {toggles.length > 0 && pages.length > 0 && <div className="my-1.5 h-px bg-white/10" />}
              {toggles.map((t) => (
                <Row key={t.key} onClick={() => t.onChange(!t.checked)}>
                  <span className="flex-1">{t.label}</span>
                  <Switch on={t.checked} />
                </Row>
              ))}
            </div>
          )
        }
      </PopoverPanel>
    </Popover>
  );
};

export default SettingsMenu;
