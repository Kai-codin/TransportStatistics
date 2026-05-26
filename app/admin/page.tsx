'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SignInButton, useUser } from '@clerk/nextjs';
import { useConvexAuth } from 'convex/react';
import { adminConfig, ADMIN_TABLE_KEYS } from '@/lib/adminConfig';
import { AdminTableView } from '@/components/admin/AdminTableView';
import { AdminEditRequestsTab } from '@/components/admin/AdminEditRequestsTab'; // Import the new requests tab component
import { LoaderCircle, Shield, Settings, FileText } from 'lucide-react';

export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const isStaff = isLoaded && user?.publicMetadata?.is_staff === 'true';
  const router = useRouter();
  const params = useSearchParams();

  // Extract the parameter or fall back to your first standard database table
  const tableParam = params.get('table') ?? ADMIN_TABLE_KEYS[0];
  
  // Validate if it's either our custom 'edit-requests' route or a valid config table
  const isEditRequestsTab = tableParam === 'edit-requests';
  const tableKey = isEditRequestsTab || adminConfig[tableParam] ? tableParam : ADMIN_TABLE_KEYS[0];

  const filterField = params.get('filterField');
  const filterValue = params.get('filterValue');

  const externalFilter = useMemo(() => {
    if (!filterField || !filterValue) return null;
    return { field: filterField, value: filterValue };
  }, [filterField, filterValue]);

  function navigate(url: string) {
    router.push(url);
  }

  // --- Auth & Access Guard Sub-Views ---
  if (isLoaded && !user) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
        <div className="rounded-3xl border border-ts-border bg-ts-surface p-6 text-center">
          <Shield className="mx-auto mb-3 h-8 w-8 text-ts-text-3" />
          <h1 className="text-xl font-bold text-ts-text-1">Sign in required</h1>
          <p className="mt-2 text-sm text-ts-text-3">
            Sign in with a staff account to access the admin dashboard.
          </p>
          <SignInButton>
            <button className="mt-4 rounded-2xl bg-ts-accent px-4 py-2 text-sm font-bold text-ts-text-inv">
              Sign in
            </button>
          </SignInButton>
        </div>
      </div>
    );
  }

  if (isLoaded && user && !isStaff) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
        <div className="rounded-3xl border border-ts-border bg-ts-surface p-6 text-center">
          <Shield className="mx-auto mb-3 h-8 w-8 text-ts-text-3" />
          <h1 className="text-xl font-bold text-ts-text-1">Admin access required</h1>
          <p className="mt-2 text-sm text-ts-text-3">
            Your account does not have staff access. Ask an admin to set the Clerk
            metadata flag <span className="font-semibold text-ts-text-2">is_staff</span> to true.
          </p>
        </div>
      </div>
    );
  }

  if (isConvexAuthLoading || !isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
        <div className="rounded-3xl border border-ts-border bg-ts-surface p-6 text-center">
          <LoaderCircle className="mx-auto mb-3 h-6 w-6 animate-spin text-ts-accent" />
          <p className="text-sm text-ts-text-3">Connecting admin session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-svh">
      {/* Sidebar: Desktop Navigation */}
      <aside className="hidden w-64 flex-shrink-0 border-r border-ts-border bg-ts-surface lg:block">
        <div className="flex items-center gap-3 border-b border-ts-border px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ts-accent/15 text-ts-accent">
            <Settings className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-ts-text-1">Admin dashboard</p>
            <p className="text-xs text-ts-text-3">Manage data</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-3 py-3">
          {/* Main Collection Data Tables */}
          <div className="px-3 mb-2 text-[10px] font-bold tracking-wider text-ts-text-3 uppercase">
            Collections
          </div>
          {ADMIN_TABLE_KEYS.map((key) => {
            const active = key === tableKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => navigate(`/admin?table=${key}`)}
                className={`rounded-2xl px-3 py-2 text-left text-sm font-semibold transition ${
                  active
                    ? 'bg-ts-accent/15 text-ts-accent'
                    : 'text-ts-text-2 hover:bg-ts-surface-2'
                }`}
              >
                {adminConfig[key].label}
              </button>
            );
          })}

          {/* Workflow Sections */}
          <div className="px-3 mt-4 mb-2 text-[10px] font-bold tracking-wider text-ts-text-3 uppercase">
            User Moderation
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin?table=edit-requests')}
            className={`rounded-2xl px-3 py-2 text-left text-sm font-semibold transition flex items-center gap-2 ${
              tableKey === 'edit-requests'
                ? 'bg-ts-accent/15 text-ts-accent'
                : 'text-ts-text-2 hover:bg-ts-surface-2'
            }`}
          >
            <FileText className="w-4 h-4" />
            Edit Requests
          </button>
        </nav>
      </aside>

      {/* Main Panel Content Window */}
      <div className="flex-1 px-4 py-6 lg:px-8">
        
        {/* Mobile Filter Header Toggle */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 lg:hidden">
          <h1 className="text-lg font-bold text-ts-text-1">Admin</h1>
          <select
            value={tableKey}
            onChange={(event) => navigate(`/admin?table=${event.target.value}`)}
            className="h-10 rounded-2xl border border-ts-border bg-ts-surface px-3 text-sm text-ts-text-1"
          >
            <optgroup label="Collections">
              {ADMIN_TABLE_KEYS.map((key) => (
                <option key={key} value={key}>{adminConfig[key].label}</option>
              ))}
            </optgroup>
            <optgroup label="User Moderation">
              <option value="edit-requests">Edit Requests</option>
            </optgroup>
          </select>
        </div>

        {/* Dynamic Route Switching Logic */}
        {tableKey === 'edit-requests' ? (
          <AdminEditRequestsTab />
        ) : (
          <AdminTableView 
            tableKey={tableKey} 
            externalFilter={externalFilter} 
            onNavigate={navigate} 
          />
        )}
      </div>
    </div>
  );
}