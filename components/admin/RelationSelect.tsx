'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { adminConfig } from '@/lib/adminConfig';

const DEFAULT_PAGE_SIZE = 25;

type RelationMode = 'admin' | 'public';

type RelationSelectProps = {
  table: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mode?: RelationMode;
};

export function RelationSelect({ table, value, onChange, placeholder, disabled, mode = 'admin' }: RelationSelectProps) {
  const [search, setSearch] = useState('');
  const tableConfig = adminConfig[table];
  const searchConfig = tableConfig?.search;

  const queryArgs = useMemo(
    () =>
      mode === 'public'
        ? {
            table,
            search: search.trim().length > 0 ? search.trim() : undefined,
          }
        : {
            table,
            search: searchConfig && search.trim().length > 0 ? search.trim() : undefined,
            searchIndex: searchConfig?.index,
            searchField: searchConfig?.field,
            filters: [],
            sort: undefined,
          },
    [mode, table, search, searchConfig]
  );

  const queryFunction = mode === 'public' ? api.functions.publicRelations.list : api.functions.admin.list;
  const { results, status, loadMore } = usePaginatedQuery(queryFunction, queryArgs, { initialNumItems: DEFAULT_PAGE_SIZE });

  useEffect(() => {
    if (status === 'CanLoadMore') {
      loadMore(DEFAULT_PAGE_SIZE);
    }
  }, [status, loadMore]);

  const options = results ?? [];
  const filteredOptions = searchConfig || search.trim().length === 0
    ? options
    : options.filter((option: any) =>
        String(option.label ?? '').toLowerCase().includes(search.trim().toLowerCase())
      );

  return (
    <div className="flex flex-col gap-2">
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={placeholder || 'Search...'}
        className="h-10 w-full rounded-2xl border border-ts-border bg-ts-surface-2 px-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20"
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-2xl border border-ts-border bg-ts-surface px-3 text-sm text-ts-text-1"
      >
        <option value="">Select...</option>
        {filteredOptions.map((option: any) => (
          <option key={option._id} value={option._id}>
            {option.label ?? option._id}
          </option>
        ))}
      </select>
    </div>
  );
}
