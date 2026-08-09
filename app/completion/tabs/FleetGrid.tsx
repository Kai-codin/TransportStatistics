import { CheckCircle2, CircleDashed } from "lucide-react";
import type { Vehicle } from "../types";

function normalizeLiveryName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeCss(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

export function FleetCard({ vehicle }: { vehicle: Vehicle }) {
  const currentLivery = vehicle.livery?.current_bustimes_livery;
  const rawPreviousLivery = vehicle.livery?.previous_bustimes_livery;
  const previousLivery =
    rawPreviousLivery &&
    normalizeLiveryName(rawPreviousLivery.name) !== normalizeLiveryName(currentLivery?.name) &&
    normalizeCss(rawPreviousLivery.css) !== normalizeCss(currentLivery?.css)
      ? rawPreviousLivery
      : null;

  return (
    <div
      className={`
        group relative flex flex-col rounded-2xl border transition-all duration-150 overflow-hidden
        ${vehicle.withdrawn
          ? "bg-ts-surface border-white/[0.04] opacity-60"
          : "bg-ts-surface border-white/[0.06] hover:bg-ts-surface-2 hover:border-white/[0.10]"
        }
      `}
    >
      <div className="flex flex-col gap-3 p-4">
        {/* ── Livery swatch + name ── */}
        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-12 aspect-[24/16] shadow-sm border border-ts-border"
            style={{ background: currentLivery?.css ?? "#2a2a2a" }}
          />
          <span className="text-[11px] font-bold text-ts-text-1/90 truncate tracking-tight">
            {currentLivery?.name ?? "Unknown"}
          </span>
        </div>

        {/* ── Fleet & Reg ── */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-mono font-black text-[20px] text-ts-text-1 tabular-nums leading-none">
              {vehicle.unit_number || ""}
            </span>
          </div>

          {vehicle.withdrawn && (
            <div className="shrink-0 px-2 py-1 rounded-lg text-[9px] font-black tracking-widest bg-[#3a1e1e]/40 text-[#f87171] border border-[#5a2d2d]/50">
              W/D
            </div>
          )}
        </div>

        {/* ── Reg badges ── */}
        <div className="inline-flex gap-1">
          {vehicle.reg && vehicle.reg !== vehicle.unit_number && (
            <span className="shrink-0 inline-block bg-[#f5c518] text-black font-black text-[10px] px-1.5 py-[2px] rounded-[4px] tracking-wider font-mono leading-none w-fit">
              {vehicle.reg}
            </span>
          )}
        </div>

        {/* ── Previous livery ── */}
        {previousLivery && (
          <div className="flex items-center gap-3 pt-1 border-t border-white/[0.05]">
            <div
              className="shrink-0 w-8 aspect-[24/16] shadow-sm border border-ts-border opacity-80"
              style={{ background: previousLivery.css ?? "#2a2a2a" }}
            />
            <div className="flex flex-col leading-none min-w-0">
              <span className="text-[7px] font-black tracking-widest text-ts-text-1/30">
                Prev:
              </span>
              <span className="text-[9px] font-bold text-ts-text-1/50 truncate">
                {previousLivery.name}
              </span>
            </div>
          </div>
        )}

        {/* ── Status footer ── */}
        <div className="flex items-center justify-between pt-2 mt-auto border-t border-white/[0.05]">
          <div
            className={`flex items-center justify-center px-2.5 py-1.5 rounded-xl border transition-all ${
              vehicle.ridden
                ? "bg-[#1e3a1e]/30 text-[#4ade80] border-[#2d5a2d]/50"
                : "bg-white/[0.03] text-ts-text-1/20 border-white/[0.05]"
            }`}
          >
            {vehicle.ridden
              ? <CheckCircle2 size={13} strokeWidth={2.5} />
              : <CircleDashed size={13} strokeWidth={2} />
            }
            <span className="ml-1.5 text-[9px] font-black tracking-widest">
              {vehicle.ridden ? "ridden" : "unridden"}
            </span>
          </div>

          {vehicle.times_ridden > 0 && (
            <span className="text-[11px] font-black text-ts-text-1/20 tabular-nums font-mono">
              ×{vehicle.times_ridden}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}