'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { adminConfig } from '@/lib/adminConfig';
import { DataTable } from './DataTable';
import { FormBuilder } from './FormBuilder';
import { RelationSelect } from './RelationSelect';

const PAGE_SIZE = 30;

type AdminTableViewProps = {
  tableKey: string;
  externalFilter?: { field: string; value: string } | null;
  onNavigate?: (url: string) => void;
};

function useSelectedRecord(records: any[], selectedId: string | null) {
  return useMemo(
    () => records.find((record) => record._id === selectedId) ?? null,
    [records, selectedId]
  );
}

function FilterInput({ filter, value, onChange }: { filter: any; value: any; onChange: (v: any) => void }) {
  if (filter.type === 'relation' && filter.table) {
    return (
      <RelationSelect
        table={filter.table}
        value={value ?? ''}
        onChange={(v) => onChange(v)}
        placeholder={`Filter ${filter.label}`}
      />
    );
  }
  if (filter.type === 'boolean') {
    return (
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-2xl border border-ts-border bg-ts-surface px-3 text-sm text-ts-text-1"
      >
        <option value="">Any {filter.label}</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  const inputType = filter.type === 'number' ? 'number' : 'text';
  return (
    <input
      type={inputType}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={`Filter ${filter.label}`}
      className="h-10 w-full rounded-2xl border border-ts-border bg-ts-surface px-3 text-sm text-ts-text-1"
    />
  );
}

export function AdminTableView({ tableKey, externalFilter, onNavigate }: AdminTableViewProps) {
  const config = adminConfig[tableKey];
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  useEffect(() => {
    setSearch('');
    setFilters({});
    setSortField('');
    setSortDirection('desc');
    setSelectedId(null);
    setCreateMode(false);
    setCursor(null);
    setCursorStack([]);
  }, [tableKey]);

  const filterSpecs = useMemo(() => {
    const activeFilters = Object.entries(filters)
      .filter(([, value]) => value !== '' && value != null)
      .map(([field, value]) => ({
        field,
        value: value === 'true' ? true : value === 'false' ? false : value,
      }));

    if (externalFilter?.field && externalFilter.value) {
      activeFilters.push({ field: externalFilter.field, value: externalFilter.value });
    }
    return activeFilters;
  }, [filters, externalFilter]);

  const queryArgs = useMemo(
    () => ({
      table: tableKey,
      search: config.search && search.trim().length > 0 ? search.trim() : undefined,
      searchIndex: config.search?.index,
      searchField: config.search?.field,
      filters: filterSpecs,
      sort: sortField ? { field: sortField, direction: sortDirection } : undefined,
    }),
    [tableKey, config.search, search, filterSpecs, sortField, sortDirection]
  );

  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
    setSelectedId(null);
  }, [queryArgs]);

  const pageResult = useQuery(api.functions.admin.list, {
    ...queryArgs,
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });

  const createMutation = useMutation(api.functions.admin.create);
  const updateMutation = useMutation(api.functions.admin.update);
  const removeMutation = useMutation(api.functions.admin.remove);

  const isLoading = pageResult === undefined;
  const rows = pageResult?.page ?? [];
  const selected = useSelectedRecord(rows, selectedId);

  const columns = config.listColumns ?? Object.keys(config.fields);

  async function handleSave(values: Record<string, any>) {
    if (createMode) {
      await createMutation({ table: tableKey, data: values });
      setCreateMode(false);
    } else if (selected?._id) {
      await updateMutation({ table: tableKey, id: selected._id, data: values });
    }
  }

  async function handleDelete() {
    if (!selected?._id) return;
    await removeMutation({ table: tableKey, id: selected._id });
    setSelectedId(null);
  }

  function handleRowSelect(row: any) {
    setSelectedId(row._id);
    setCreateMode(false);
  }

  function openCreate() {
    setCreateMode(true);
    setSelectedId(null);
  }

  const initialValues = createMode ? {} : selected ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ts-text-1">{config.label}</h2>
            {config.description && <p className="text-xs text-ts-text-3">{config.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="rounded-2xl bg-ts-accent px-4 py-2 text-sm font-bold text-ts-text-inv"
            >
              New
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-ts-border bg-ts-surface p-4">
          <div className="grid gap-3 lg:grid-cols-[2fr_repeat(2,1fr)]">
            {config.search && (
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={config.search.placeholder ?? 'Search'}
                className="h-10 w-full rounded-2xl border border-ts-border bg-ts-surface-2 px-3 text-sm text-ts-text-1"
              />
            )}
            {config.filters?.map((filter) => (
              <FilterInput
                key={filter.field}
                filter={filter}
                value={filters[filter.field]}
                onChange={(value) => setFilters((prev) => ({ ...prev, [filter.field]: value }))}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ts-text-3">
            <span>Sort</span>
            <select
              value={sortField}
              onChange={(event) => setSortField(event.target.value)}
              className="h-8 rounded-xl border border-ts-border bg-ts-surface px-2"
            >
              <option value="">Default</option>
              {columns.map((column) => (
                <option key={column} value={column}>{column}</option>
              ))}
            </select>
            <select
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}
              className="h-8 rounded-xl border border-ts-border bg-ts-surface px-2"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
            {externalFilter && (
              <button
                type="button"
                onClick={() => onNavigate?.(`/admin?table=${tableKey}`)}
                className="rounded-xl border border-ts-border px-2 py-1 text-xs"
              >
                Clear linked filter
              </button>
            )}
          </div>
        </div>

        <DataTable
          key={tableKey}
          rows={rows}
          columns={columns}
          fields={config.fields}
          isLoading={isLoading}
          selectedId={selectedId}
          onSelect={handleRowSelect}
        />

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (cursorStack.length === 0) return;
              const nextStack = [...cursorStack];
              const prevCursor = nextStack.pop() ?? null;
              setCursorStack(nextStack);
              setCursor(prevCursor);
            }}
            disabled={cursorStack.length === 0}
            className="rounded-2xl border border-ts-border px-4 py-2 text-sm font-semibold text-ts-text-2 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-ts-text-3">
            Page {cursorStack.length + 1}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!pageResult || pageResult.isDone || !pageResult.continueCursor) return;
              setCursorStack((prev) => [...prev, cursor ?? '']);
              setCursor(pageResult.continueCursor);
            }}
            disabled={!pageResult || pageResult.isDone || !pageResult.continueCursor}
            className="rounded-2xl border border-ts-border px-4 py-2 text-sm font-semibold text-ts-text-2 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      <aside className="rounded-3xl border border-ts-border bg-ts-surface p-4">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-ts-text-1">{createMode ? 'Create record' : 'Edit record'}</h3>
          <p className="text-xs text-ts-text-3">Table: {tableKey}</p>
        </div>
        <FormBuilder
          fields={config.fields}
          initialValues={initialValues}
          onSubmit={handleSave}
          onDelete={!createMode ? handleDelete : undefined}
          isEditing={!createMode}
        />
        {!createMode && selected?.uid && tableKey === 'trainDetails' && (
          <div className="mt-6 rounded-2xl border border-ts-border-soft bg-ts-surface-2 p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-ts-text-3">Allocations</p>
            <p className="mt-2 text-sm text-ts-text-1">UID: {selected.uid}</p>
            <button
              type="button"
              onClick={() => onNavigate?.(`/admin?table=trainAllocations&filterField=uid&filterValue=${selected.uid}`)}
              className="mt-3 rounded-xl border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2"
            >
              View allocations
            </button>
          </div>
        )}
        {!createMode && selected?.uid && tableKey === 'trainAllocations' && (
          <div className="mt-6 rounded-2xl border border-ts-border-soft bg-ts-surface-2 p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-ts-text-3">Linked trains</p>
            <p className="mt-2 text-sm text-ts-text-1">UID: {selected.uid}</p>
            <button
              type="button"
              onClick={() => onNavigate?.(`/admin?table=trainDetails&filterField=uid&filterValue=${selected.uid}`)}
              className="mt-3 rounded-xl border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2"
            >
              View trains
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
