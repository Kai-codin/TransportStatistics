'use client';

import React, { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { EditRequestDiffViewer } from './EditRequestDiffViewer';
import { Check, X, Clock, LoaderCircle } from 'lucide-react';

export function AdminEditRequestsTab() {
  // Path updated to match your convex/functions/ folder hierarchy
  const requests = useQuery(api.functions.editRequests.getEditRequests);
  const approve = useMutation(api.functions.editRequests.approveEditRequest);
  const decline = useMutation(api.functions.editRequests.declineEditRequest);

  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'declined'>('pending');
  const [declineReason, setDeclineReason] = useState<Record<string, string>>({});
  const [activeDeclineId, setActiveDeclineId] = useState<string | null>(null);

  if (requests === undefined) {
    return (
      <div className="flex justify-center py-12">
        <LoaderCircle className="animate-spin text-ts-accent h-6 w-6" />
      </div>
    );
  }

  const filteredRequests = requests.filter(req => filterStatus === 'all' ? true : req.status === filterStatus);

  const handleApprove = async (id: any) => {
    if (!confirm("Are you sure you want to approve this request and modify live records?")) return;
    try {
      await approve({ id });
    } catch (e: any) {
      alert(`Approval error: ${e.message}`);
    }
  };

  const handleDeclineSubmit = async (id: any) => {
    const reason = declineReason[id];
    if (!reason || reason.trim() === '') {
      alert("A reason is required to decline a request.");
      return;
    }
    try {
      await decline({ id, adminReason: reason });
      setActiveDeclineId(null);
    } catch (e: any) {
      alert(`Decline error: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-ts-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-ts-text-1">Data Edit Submissions</h2>
          <p className="text-xs text-ts-text-3">Approve or reject user-submitted field enhancements safely.</p>
        </div>
        <select
          value={filterStatus}
          onChange={(e: any) => setFilterStatus(e.target.value)}
          className="h-9 border border-ts-border rounded-xl bg-ts-surface text-xs font-semibold px-3 text-ts-text-1"
        >
          <option value="pending">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
          <option value="all">All Submissions</option>
        </select>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-3xl text-ts-text-3 text-sm border-ts-border">
          No records match the selected status filter.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRequests.map((req) => (
            <div key={req._id} className="border border-ts-border rounded-3xl p-6 bg-ts-surface space-y-4 shadow-sm">
              <div className="flex flex-wrap justify-between items-start gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-ts-accent/10 text-ts-accent capitalize">{req.table}</span>
                    <span className="text-xs font-mono text-ts-text-3">Doc ID: {req.recordId}</span>
                  </div>
                  <p className="text-xs text-ts-text-3">Submitted by: <strong className="text-ts-text-2">{req.userEmail}</strong> ({new Date(req.createdAt).toLocaleString()})</p>
                </div>
                
                <div className="flex items-center gap-2">
                  {req.status === 'pending' && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"><Clock className="w-3 h-3"/> Pending</span>
                  )}
                  {req.status === 'approved' && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"><Check className="w-3 h-3"/> Approved</span>
                  )}
                  {req.status === 'declined' && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400"><X className="w-3 h-3"/> Declined</span>
                  )}
                </div>
              </div>

              <div className="bg-ts-surface-2 p-3 rounded-xl border border-ts-border text-sm text-ts-text-2">
                <span className="block text-xs font-bold text-ts-text-3 uppercase tracking-wide mb-1">User Reason:</span>
                "{req.userReason}"
              </div>

              {/* Display Diff Matrix */}
              <EditRequestDiffViewer from={req.from} to={req.to} />

              {req.adminReason && (
                <div className="bg-rose-50 dark:bg-rose-950/10 text-rose-800 dark:text-rose-300 p-3 rounded-xl border border-rose-200/30 text-xs">
                  <strong>Admin Rejection Note:</strong> {req.adminReason}
                </div>
              )}

              {/* Action Buttons Interface */}
              {req.status === 'pending' && (
                <div className="pt-3 border-t border-ts-border flex flex-col gap-3">
                  {activeDeclineId !== req._id ? (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setActiveDeclineId(req._id)}
                        className="h-9 px-4 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl border border-rose-200 transition flex items-center gap-1.5"
                      >
                        <X className="w-3 h-3" /> Decline Request
                      </button>
                      <button
                        onClick={() => handleApprove(req._id)}
                        className="h-9 px-4 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition flex items-center gap-1.5 shadow-sm"
                      >
                        <Check className="w-3 h-3" /> Approve & Apply
                      </button>
                    </div>
                  ) : (
                    <div className="bg-ts-surface-2 p-4 rounded-2xl border border-ts-border space-y-3">
                      <label className="text-xs font-bold text-ts-text-1">Specify Reason for Decline</label>
                      <input
                        type="text"
                        placeholder="Provide text feedback..."
                        value={declineReason[req._id] || ''}
                        onChange={(e) => setDeclineReason({ ...declineReason, [req._id]: e.target.value })}
                        className="w-full h-9 px-3 text-sm bg-ts-surface border rounded-xl border-ts-border"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setActiveDeclineId(null)} className="h-8 px-3 text-xs font-semibold rounded-lg text-ts-text-3">Cancel</button>
                        <button onClick={() => handleDeclineSubmit(req._id)} className="h-8 px-3 text-xs font-bold bg-rose-600 text-white rounded-lg">Confirm Rejection</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}