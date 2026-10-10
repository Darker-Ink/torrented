import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import clsx from "clsx";
import type { ReactNode } from "react";

export type Section = { key: string; label: ReactNode; content: ReactNode; count?: number };

type Props = { sections: Section[]; selectedIndex?: number; onChange?: (i: number) => void };

/** Large underline tabs used to split a title page into sections. */
const SectionTabs = ({ sections, selectedIndex, onChange }: Props) => (
  <TabGroup selectedIndex={selectedIndex} onChange={onChange} className="px-4 sm:px-10">
    <TabList className="flex gap-6 border-b border-white/[0.08]">
      {sections.map((s) => (
        <Tab
          key={s.key}
          className={clsx(
            "relative -mb-px flex cursor-pointer items-center gap-2 border-b-2 border-transparent pb-3 text-base font-semibold text-fg/50 transition focus:outline-none",
            "data-[hover]:text-fg/80 data-[selected]:border-primary data-[selected]:text-fg",
          )}
        >
          {s.label}
          {s.count !== undefined && (
            <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs font-semibold text-fg/70">{s.count}</span>
          )}
        </Tab>
      ))}
    </TabList>
    <TabPanels className="pt-8">
      {sections.map((s) => (
        <TabPanel key={s.key} className="focus:outline-none">
          {s.content}
        </TabPanel>
      ))}
    </TabPanels>
  </TabGroup>
);

export default SectionTabs;
