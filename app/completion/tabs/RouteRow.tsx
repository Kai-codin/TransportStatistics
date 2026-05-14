import { CheckCircle2, CircleDashed } from "lucide-react";
import type { RouteInfo } from "../types";

export function RouteRow({ route }: { route: RouteInfo }) {
  return (
    <div
      className={`
        group relative flex items-center gap-4 px-5 py-3.5
        rounded-2xl border transition-all duration-150
        ${route.withdrawn
          ? "bg-ts-surface border-white/[0.04] opacity-55 hover:opacity-75"
          : "bg-ts-surface border-white/[0.06] hover:bg-ts-surface-2 hover:border-white/[0.10]"
        }
      `}
    >
      <div className="shrink-0 flex items-center gap-3 min-w-0">
        <span className="shrink-0 inline-flex items-center justify-center min-w-14 px-3 py-1.5 rounded-xl bg-[var(--color-ts-accent-light)] border border-[var(--color-ts-accent-border)] text-[13px] font-black text-[var(--color-ts-text-1)] tabular-nums tracking-tight">
          {route.service_number}
        </span>

        <div className="min-w-0">
          <p className="text-[13px] font-bold text-[var(--color-ts-text-1)] truncate leading-tight">
            {route.route_name}
          </p>
          {route.inbound_destination || route.outbound_destination ? (
            <p className="text-[11px] font-medium text-white/35 truncate leading-tight mt-0.5">
              {route.inbound_destination && route.outbound_destination
                ? `${route.inbound_destination} → ${route.outbound_destination}`
                : route.inbound_destination || route.outbound_destination}
            </p>
          ) : null}
        </div>
      </div>

      <div className="ml-auto shrink-0 flex items-center gap-3">
        {route.times_ridden > 0 && (
          <span className="text-[11px] font-black text-white/35 tabular-nums font-mono">
            ×{route.times_ridden}
          </span>
        )}

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${
            route.ridden
              ? "bg-[#1e3a1e] text-[#4ade80] border-[#2d5a2d]/60"
              : "bg-white/[0.04] text-white/30 border-white/[0.07]"
          }`}
        >
          {route.ridden ? (
            <CheckCircle2 size={10} strokeWidth={2.5} />
          ) : (
            <CircleDashed size={10} strokeWidth={2} />
          )}
          {route.ridden ? "ridden" : "unridden"}
        </div>

        {route.withdrawn && (
          <div className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-[#3a1e1e] text-[#f87171] border border-[#5a2d2d]/60">
            withdrawn
          </div>
        )}
      </div>
    </div>
  );
}