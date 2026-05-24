'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { AdminField } from '@/lib/adminConfig';

function getLabel(record: any) {
  return (
    record?.display_name ||
    record?.name ||
    record?.type_name ||
    record?.livery_name ||
    record?.operator_name ||
    record?.code ||
    record?._id ||
    'Unknown'
  );
}

type DataTableProps = {
  rows: any[];
  columns: string[];
  fields: Record<string, AdminField>;
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect: (row: any) => void;
};

export function DataTable({ rows, columns, fields, isLoading, selectedId, onSelect }: DataTableProps) {
  const relationTables = useMemo(() => {
    const tables = new Set<string>();
    columns.forEach((key) => {
      const field = fields[key];
      if (field?.type === 'relation' && field.table) tables.add(field.table);
    });
    return Array.from(tables);
  }, [columns, fields]);

  const relationIdsByTable = useMemo(() => {
    const map: Record<string, string[]> = {};
    relationTables.forEach((table) => {
      map[table] = [];
    });
    rows.forEach((row) => {
      columns.forEach((key) => {
        const field = fields[key];
        if (field?.type === 'relation' && field.table && row[key]) {
          const list = map[field.table];
          if (list && !list.includes(row[key])) list.push(row[key]);
        }
      });
    });
    return map;
  }, [columns, fields, relationTables, rows]);

  const relationMaps = relationTables.reduce((acc, table) => {
    const ids = relationIdsByTable[table] || [];
    const records = useQuery(api.functions.admin.getByIds, { table, ids }) ?? [];
    const map = new Map<string, string>();
    records.forEach((record: any) => map.set(record._id, getLabel(record)));
    acc[table] = map;
    return acc;
  }, {} as Record<string, Map<string, string>>);

  function renderValue(row: any, key: string) {
    const field = fields[key];
    const value = row[key];
    if (field?.type === 'relation' && field.table) {
      const map = relationMaps[field.table];
      return map?.get(value) ?? value ?? '—';
    }
    if (field?.type === 'json') {
      if (value == null) return '—';
      return Array.isArray(value) ? `[${value.length} items]` : '{...}';
    }
    if (field?.type === 'boolean') return value ? 'Yes' : 'No';
    if (value == null || value === '') return '—';
    return String(value);
  }

  return (
    <div className="overflow-x-auto rounded-3xl border border-ts-border bg-ts-surface">
      <table className="w-full text-left text-sm">
        <thead className="bg-ts-surface-2 text-xs uppercase tracking-widest text-ts-text-3">
          <tr>
            {columns.map((key) => (
              <th key={key} className="px-4 py-3 font-semibold">{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-ts-text-3">
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-ts-border border-t-ts-accent" />
                  Loading records…
                </span>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-ts-text-3">
                No records found
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row._id}
                onClick={() => onSelect(row)}
                className={`cursor-pointer border-t border-ts-border-soft transition hover:bg-ts-surface-2 ${
                  selectedId === row._id ? 'bg-ts-accent/10' : ''
                }`}
              >
                {columns.map((key) => (
                  <td key={key} className="px-4 py-3 text-ts-text-1">
                    {renderValue(row, key)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
