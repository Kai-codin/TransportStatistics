'use client';

import { useState } from 'react';

interface TabItem {
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  defaultIndex?: number;
}

export default function Tabs({ tabs, defaultIndex = 0 }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultIndex);

  return (
    <div className="w-full">
      {/* Tab List */}
      <div className="border-b border-ts-border">
        <div className="flex gap-6 overflow-x-auto no-scrollbar px-1">
          {tabs.map((tab, index) => {
            const isActive = activeTab === index;

            return (
              <button
                key={tab.label}
                onClick={() => setActiveTab(index)}
                className={`
                  relative py-3 text-sm font-medium whitespace-nowrap
                  transition-all duration-200
                  ${
                    isActive
                      ? 'text-ts-accent'
                      : 'text-ts-text-2 hover:text-ts-text-1'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}

                {/* Animated underline */}
                <span
                  className={`
                    absolute left-0 -bottom-[1px] h-[2px] w-full
                    transition-all duration-200
                    ${
                      isActive
                        ? 'bg-ts-accent opacity-100'
                        : 'opacity-0 group-hover:opacity-50'
                    }
                  `}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="mt-6">
        <div className="animate-in fade-in duration-200">
          {tabs[activeTab].content}
        </div>
      </div>
    </div>
  );
}