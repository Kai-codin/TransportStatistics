'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AdminField } from '@/lib/adminConfig';
import { JsonEditor } from './JsonEditor';
import { RelationSelect } from './RelationSelect';

export type FormBuilderProps = {
  fields: Record<string, AdminField>;
  initialValues: Record<string, any>;
  onSubmit: (values: Record<string, any>) => void;
  onDelete?: () => void;
  isSaving?: boolean;
  isEditing?: boolean;
};

function normalizeJson(value: unknown) {
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function coerceValue(type: AdminField['type'], value: any) {
  if (type === 'boolean') return Boolean(value);
  if (type === 'number') return value == null ? '' : String(value);
  if (type === 'json') return normalizeJson(value);
  return value == null ? '' : String(value);
}

function parseValue(type: AdminField['type'], value: any) {
  if (type === 'number') {
    if (value === '') return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (type === 'boolean') return Boolean(value);
  if (type === 'json') {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value === '' ? undefined : value;
}

export function FormBuilder({ fields, initialValues, onSubmit, onDelete, isSaving, isEditing }: FormBuilderProps) {
  const orderedFields = useMemo(
    () => Object.entries(fields).filter(([, config]) => !config.hidden),
    [fields]
  );

  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    const nextValues: Record<string, any> = {};
    for (const [key, config] of orderedFields) {
      nextValues[key] = coerceValue(config.type, initialValues[key]);
    }
    setValues(nextValues);
  }, [initialValues, orderedFields]);

  function updateField(key: string, nextValue: any) {
    setValues((prev) => ({ ...prev, [key]: nextValue }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const payload: Record<string, any> = {};
    for (const [key, config] of orderedFields) {
      payload[key] = parseValue(config.type, values[key]);
    }
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-3">
        {orderedFields.map(([key, config]) => {
          const label = config.label || key;
          const value = values[key];
          const readOnly = config.readOnly || isSaving;

          if (config.type === 'json') {
            return (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">{label}</span>
                <JsonEditor value={value ?? ''} onChange={(v) => updateField(key, v)} readOnly={readOnly} />
              </label>
            );
          }

          if (config.type === 'relation' && config.table) {
            return (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">{label}</span>
                <RelationSelect
                  table={config.table}
                  value={value ?? ''}
                  onChange={(v) => updateField(key, v)}
                  disabled={readOnly}
                />
              </label>
            );
          }

          if (config.type === 'textarea') {
            return (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">{label}</span>
                <textarea
                  value={value ?? ''}
                  onChange={(event) => updateField(key, event.target.value)}
                  readOnly={readOnly}
                  className="min-h-[120px] w-full rounded-2xl border border-ts-border bg-ts-surface-2 px-3 py-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20"
                />
              </label>
            );
          }

          if (config.type === 'boolean') {
            return (
              <label key={key} className="flex items-center gap-2 text-sm text-ts-text-1">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => updateField(key, event.target.checked)}
                  disabled={readOnly}
                />
                {label}
              </label>
            );
          }

          const inputType = config.type === 'number' ? 'number' : 'text';

          return (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-ts-text-3">{label}</span>
              <input
                type={inputType}
                value={value ?? ''}
                onChange={(event) => updateField(key, event.target.value)}
                readOnly={readOnly}
                className="h-10 w-full rounded-2xl border border-ts-border bg-ts-surface-2 px-3 text-sm text-ts-text-1 outline-none transition focus:border-ts-accent focus:ring-2 focus:ring-ts-accent/20"
              />
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-2xl bg-ts-accent px-4 py-2 text-sm font-bold text-ts-text-inv transition hover:bg-ts-accent-h disabled:opacity-60"
        >
          {isEditing ? 'Save changes' : 'Create'}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isSaving}
            className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
