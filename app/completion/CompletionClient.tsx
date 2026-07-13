"use client";

import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";

import { OverviewTab } from "./tabs/OverviewTab";
import { FleetTab } from "./tabs/FleetTab";
import { RoutesTab } from "./tabs/RoutesTab";

// Updated to match your new merged schema
interface Operator {
  _id: string;
  display_name: string;
  operator_names: string[];
  operator_slugs: string[];
  operator_codes: string[];
  bustimes_id?: number;
}

type Tab = "overview" | "fleet" | "routes";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fleet", label: "Fleet" },
  { id: "routes", label: "Routes" },
];

function OperatorCard({ operator }: { operator: Operator }) {
  // Use the first slug and code for the link, but display the primary name
  const primarySlug = operator.operator_slugs[0];
  const primaryCode = operator.operator_codes[0];
  
  const href = `/completion?operator=${primarySlug}&name=${encodeURIComponent(operator.display_name)}&code=${primaryCode}`;

  return (
    <Link
      href={href}
      className="group flex flex-col justify-between gap-1 min-h-[120px] bg-[var(--color-ts-surface)] border border-[var(--color-ts-border-soft)] rounded-2xl p-5 hover:bg-[var(--color-ts-surface-2)] hover:border-[var(--color-ts-border)] transition-all duration-150"
    >
      <div className="flex items-start justify-between">
        <p className="text-[13px] font-bold text-[var(--color-ts-text-2)] leading-snug group-hover:text-[var(--color-ts-text-1)] transition-colors">
          {operator.display_name}
        </p>
        <ChevronRight
          size={13}
          className="text-[var(--color-ts-text-3)] opacity-40 group-hover:opacity-100 transition-colors shrink-0 mb-0.5"
        />
      </div>
      <div className="flex items-start justify-between">
        <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-[var(--color-ts-accent-light)] border border-[var(--color-ts-accent-border)] text-[var(--color-ts-accent)] flex items-center justify-center shrink-0">
          {primaryCode}
        </span>
      </div>
    </Link>
  );
}

function OperatorGrid() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/operators/${showAll ? "?all=1" : ""}`)
      .then((r) => r.json())
      .then((data) => setOperators(data.operators ?? []))
      .finally(() => setIsLoading(false));
  }, [showAll]);

  // Updated filter: Case-insensitive search across display_name, names, and codes
  const filtered = operators.filter((o) => {
    const term = search.toLowerCase();
    return (
      o.display_name.toLowerCase().includes(term) ||
      o.operator_names.some((n) => n.toLowerCase().includes(term)) ||
      o.operator_codes.some((c) => c.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-4xl font-black text-[var(--color-ts-text-1)] tracking-tight">Fleet Completion</h1>
        <p className="text-sm text-[var(--color-ts-text-3)] mt-1.5">Track your rides across every operator</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={13}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ts-text-3)] pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search codes or names…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--color-ts-surface)] border border-[var(--color-ts-border-soft)] rounded-xl pl-9 pr-4 py-2.5 text-[12px] text-[var(--color-ts-text-2)] placeholder:text-[var(--color-ts-text-3)] outline-none focus:border-[var(--color-ts-accent-border)] transition-colors"
          />
        </div>

        <button
          onClick={() => setShowAll(!showAll)}
          className={`px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap ${
            showAll
              ? "bg-[var(--color-ts-surface-3)] border-[var(--color-ts-accent-border)] text-[var(--color-ts-accent)]"
              : "bg-[var(--color-ts-surface)] border border-[var(--color-ts-border-soft)] text-[var(--color-ts-text-3)] hover:border-[var(--color-ts-border)] hover:text-[var(--color-ts-text-2)]"
          }`}
        >
          {showAll ? "All operators" : "My operators"}
        </button>

        <span className="text-[10px] font-bold text-[var(--color-ts-text-3)] uppercase tracking-widest whitespace-nowrap sm:ml-auto">
          {isLoading ? "—" : `${filtered.length} operators`}
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="h-[130px] rounded-2xl bg-[var(--color-ts-surface)] animate-pulse"
              style={{ opacity: Math.max(0.15, 1 - i * 0.045) }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center">
          <p className="text-[var(--color-ts-text-3)] text-sm font-medium">No operators found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((op) => (
            <OperatorCard key={op._id} operator={op} />
          ))}
        </div>
      )}
    </div>
  );
}

function OperatorDetail({ operatorSlug, operatorName, operatorCode }: { operatorSlug: string; operatorName: string; operatorCode: string; }) {
  const { user, isLoaded } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const stats = useQuery(
    api.functions.completion.getOperatorCompletionStats,
    isLoaded && user && operatorCode && activeTab === "overview"
      ? { user: user.id, operator_code: operatorCode, timeZone }
      : "skip"
  );

  if (!isLoaded) return <div className="h-screen bg-[var(--color-ts-bg)] animate-pulse rounded-2xl" />;

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--color-ts-text-3)] mb-5">
          <Link href="/completion" className="hover:text-[var(--color-ts-text-2)] transition-colors">
            Completion
          </Link>
          <ChevronRight size={10} />
          <span className="text-[var(--color-ts-text-2)] font-bold">{operatorName}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <h1 className="text-4xl font-black text-[var(--color-ts-text-1)] tracking-tight">{operatorName}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className="px-2 py-0.5 bg-[var(--color-ts-surface)] rounded-lg text-[10px] font-black text-[var(--color-ts-text-3)] border border-[var(--color-ts-border-soft)] font-mono tracking-widest">
                {operatorCode}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-6 border-b border-[var(--color-ts-border-soft)] mb-8">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`pb-4 text-[10px] font-black uppercase tracking-widest transition-all relative ${
              activeTab === id ? "text-[var(--color-ts-accent)]" : "text-[var(--color-ts-text-3)] hover:text-[var(--color-ts-text-2)]"
            }`}
          >
            {label}
            {activeTab === id && (
              <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[var(--color-ts-accent)] rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <OverviewTab operatorSlug={operatorSlug} stats={stats ?? undefined} />
      )}
      {activeTab === "fleet" && <FleetTab operatorCode={operatorCode} />}
      {activeTab === "routes" && <RoutesTab operatorCode={operatorCode} />}
    </div>
  );
}

export default function CompletionClient({ operatorSlug, operatorName, operatorCode }: { operatorSlug: string | null; operatorName: string; operatorCode: string; }) {
  if (operatorSlug) {
    return <OperatorDetail operatorSlug={operatorSlug} operatorName={operatorName} operatorCode={operatorCode} />;
  }

  return <OperatorGrid />;
}