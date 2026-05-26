'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { editConfig } from '@/lib/editConfig';
import { RelationDropdown } from '@/components/admin/RelationDropdown'; // Import the dropdown handler
import { LoaderCircle, CheckCircle } from 'lucide-react';

export default function UserEditRequestPage() {
  const params = useParams();
  const router = useRouter();
  const table = params.table as string;
  const id = params.id as string;

  const config = editConfig[table];
  const currentRecord = useQuery(api.functions.editRequests.getRecordByTableAndId, { table, id });
  const submitRequest = useMutation(api.functions.editRequests.createEditRequest);

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [userReason, setUserReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (currentRecord && config) {
      const initialFields: Record<string, any> = {};
      config.fields.forEach((field) => {
        initialFields[field] = currentRecord[field] ?? '';
      });
      setFormData(initialFields);
    }
  }, [currentRecord, config]);

  if (!config) return <div className="p-8 text-ts-danger font-bold">Error: Table type not configured for user edits.</div>;
  if (currentRecord === undefined) return <div className="flex justify-center p-12"><LoaderCircle className="animate-spin text-ts-accent" /></div>;
  if (currentRecord === null) return <div className="p-8 text-center text-ts-text-2">Record not found.</div>;

  const handleFieldChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const fromSnapshot: Record<string, any> = {};
      const toSnapshot: Record<string, any> = {};

      config.fields.forEach((field) => {
        const originalValue = currentRecord[field];
        const newValue = formData[field];

        if (JSON.stringify(originalValue) !== JSON.stringify(newValue)) {
          fromSnapshot[field] = originalValue ?? null;
          toSnapshot[field] = newValue;
        }
      });

      if (Object.keys(toSnapshot).length === 0) {
        alert("No fields values were modified.");
        setSubmitting(false);
        return;
      }

      await submitRequest({
        table,
        recordId: id,
        from: fromSnapshot,
        to: toSnapshot,
        userReason,
      });

      setSuccess(true);
    } catch (err) {
      console.error(err);
      alert("Submission encountered errors.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center border rounded-2xl bg-ts-surface border-ts-border mt-12">
        <CheckCircle className="mx-auto text-ts-accent h-12 w-12 mb-4" />
        <h2 className="text-xl font-bold mb-2 text-ts-text-1">Edit Request Lodged!</h2>
        <p className="text-sm text-ts-text-3 mb-6">Administrators have been notified to review your suggested parameters.</p>
        <button 
          onClick={() => router.back()} 
          className="px-4 py-2 bg-ts-accent hover:bg-ts-accent-h text-ts-text-inv rounded-xl text-sm font-semibold transition"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight mb-1 text-ts-text-1">
        Suggest Edits to: <span className="text-ts-accent">{currentRecord[config.displayField] || id}</span>
      </h1>
      <p className="text-sm text-ts-text-3 mb-6">Modifications undergo administrative vetting prior to going live.</p>

      <form onSubmit={handleSubmit} className="space-y-4 border rounded-3xl p-6 bg-ts-surface border-ts-border shadow-sm">
        {config.fields.map((field) => {
          const val = formData[field];
          const isBool = typeof currentRecord[field] === 'boolean';
          
          // Check if this specific field has an active relational mapping configuration
          const relationConfig = config.relations?.[field];

          return (
            <div key={field} className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-ts-text-2 uppercase tracking-wider">{field}</label>
              
              {isBool ? (
                <select
                  value={val ? "true" : "false"}
                  onChange={(e) => handleFieldChange(field, e.target.value === "true")}
                  className="h-10 border border-ts-border rounded-xl bg-ts-surface-2 px-3 text-sm text-ts-text-1 focus:outline-none focus:border-ts-accent"
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : relationConfig ? (
                /* Swap input text node out for our remote-fetched option component */
                <RelationDropdown 
                  relationConfig={relationConfig}
                  value={val}
                  onChange={(newVal) => handleFieldChange(field, newVal)}
                />
              ) : (
                <input
                  type={typeof currentRecord[field] === 'number' ? 'number' : 'text'}
                  step="any"
                  value={val ?? ''}
                  onChange={(e) => handleFieldChange(field, typeof currentRecord[field] === 'number' ? parseFloat(e.target.value) : e.target.value)}
                  className="h-10 border border-ts-border rounded-xl bg-ts-surface-2 px-3 text-sm text-ts-text-1 focus:outline-none focus:border-ts-accent focus:ring-1 focus:ring-ts-accent-glow"
                />
              )}
            </div>
          );
        })}

        <div className="flex flex-col gap-1.5 pt-4 border-t border-ts-border">
          <label className="text-xs font-bold text-ts-text-2 uppercase tracking-wider">Reason for this modification</label>
          <textarea
            required
            rows={3}
            placeholder="Explain why these fields should be updated..."
            value={userReason}
            onChange={(e) => setUserReason(e.target.value)}
            className="border border-ts-border rounded-xl bg-ts-surface-2 p-3 text-sm text-ts-text-1 focus:outline-none focus:border-ts-accent focus:ring-1 focus:ring-ts-accent-glow"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-11 bg-ts-accent hover:bg-ts-accent-h disabled:opacity-40 text-ts-text-inv font-bold rounded-xl transition text-sm flex items-center justify-center gap-2 cursor-pointer shadow-sm"
        >
          {submitting && <LoaderCircle className="animate-spin h-4 w-4" />}
          Submit Changes for Review
        </button>
      </form>
    </div>
  );
}