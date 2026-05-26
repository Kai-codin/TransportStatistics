import React from 'react';

interface DiffViewerProps {
  from: Record<string, any>;
  to: Record<string, any>;
}

export function EditRequestDiffViewer({ from, to }: DiffViewerProps) {
  const targetFields = Object.keys(to);

  return (
    <div className="overflow-hidden border border-ts-border rounded-2xl bg-ts-surface-2 text-sm">
      <div className="grid grid-cols-3 gap-4 px-4 py-2 bg-ts-border/30 text-xs font-bold uppercase text-ts-text-3 tracking-wider border-b border-ts-border">
        <div>Field Key</div>
        <div>Original State</div>
        <div>Proposed State</div>
      </div>
      <div className="divide-y divide-ts-border">
        {targetFields.map((field) => (
          <div key={field} className="grid grid-cols-3 gap-4 px-4 py-3 items-center">
            <span className="font-mono text-xs font-bold text-ts-text-1 bg-ts-border/40 px-1.5 py-0.5 rounded max-w-fit">{field}</span>
            <div className="text-red-600 bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded border border-red-200/40 line-through truncate">
              {String(from[field] ?? '[Empty/Null]')}
            </div>
            <div className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 rounded border border-emerald-200/40 font-semibold truncate">
              {String(to[field])}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}