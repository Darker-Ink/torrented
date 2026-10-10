import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import clsx from "clsx";
import type { ReactNode } from "react";

export type TabItem = { key: string; label: ReactNode; content: ReactNode };

type Props = {
  tabs: TabItem[];
  selectedIndex?: number;
  onChange?: (index: number) => void;
  className?: string;
};

const Tabs = ({ tabs, selectedIndex, onChange, className }: Props) => (
  <TabGroup selectedIndex={selectedIndex} onChange={onChange} className={className}>
    <TabList className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Tab
          key={t.key}
          className={clsx(
            "-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-muted transition focus:outline-none",
            "data-[hover]:text-fg data-[selected]:border-primary data-[selected]:text-fg",
          )}
        >
          {t.label}
        </Tab>
      ))}
    </TabList>
    <TabPanels className="pt-6">
      {tabs.map((t) => (
        <TabPanel key={t.key} className="focus:outline-none">
          {t.content}
        </TabPanel>
      ))}
    </TabPanels>
  </TabGroup>
);

export default Tabs;
