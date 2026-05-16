import { CheckCircle2, CircleDashed } from "lucide-react";
import type { Vehicle } from "../types";

export function FleetRow({ vehicle }: { vehicle: Vehicle }) {
  const currentLivery = vehicle.livery?.current_bustimes_livery;
  const previousLivery = vehicle.livery?.previous_bustimes_livery;

  return (
    <div
      className={`
        group relative flex items-center px-3 sm:px-5 h-[72px] sm:h-[80px]
        rounded-2xl border transition-all duration-150
        ${vehicle.withdrawn
          ? "bg-ts-surface border-white/[0.04] opacity-60"
          : "bg-ts-surface border-white/[0.06] hover:bg-ts-surface-2 hover:border-white/[0.10]"
        }
      `}
    >
      {/* ── SECTION 1: Liveries Stack ── */}
      <div className="flex flex-col gap-1.5 w-12 sm:w-56 shrink-0 mr-4 sm:mr-6">
        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-12 aspect-[24/16] shadow-sm border border-ts-border"
            style={{ background: currentLivery?.css ?? "#2a2a2a" }}
          />
          <span className="text-[11px] hidden sm:block font-bold text-white/90 truncate tracking-tight uppercase">
            {currentLivery?.name ?? "Unknown"}
          </span>
        </div>

        {previousLivery && (
          <div className="flex items-center gap-3">
             <div 
              className="shrink-0 w-8 aspect-[24/16] shadow-sm border border-ts-border opacity-80" 
              style={{ background: previousLivery.css ?? "#2a2a2a" }} 
            />
            <div className="hidden sm:flex flex-col leading-none">
              <span className="text-[7px] font-black uppercase tracking-widest text-white/30">
                Prev:
              </span>
              <span className="text-[9px] font-bold uppercase text-white/50 truncate max-w-[140px]">
                {previousLivery.name}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 2: Fleet & Reg ── */}
      <div className="flex flex-col justify-center gap-1 shrink-0 min-w-[50px] sm:min-w-[100px]">
        <span className="font-mono font-black text-[18px] sm:text-[22px] text-white tabular-nums leading-none">
          {vehicle.unit_number || ""}
        </span>
        <div className="flex flex-col gap-1">
          <span className="shrink-0 inline-block bg-[#f5c518] text-black font-black text-[9px] sm:text-[10px] px-1.5 py-[2px] rounded-[4px] tracking-wider uppercase font-mono leading-none w-fit">
            {vehicle.reg || "•••••••"}
          </span>
          {/* Previous Reg addition */}
          {vehicle.previous_reg && vehicle.previous_reg !== vehicle.reg && (
            <div className="flex items-center gap-1">
              <span className="text-[7px] font-black uppercase text-white/20">was</span>
              <span className="text-[9px] font-bold font-mono text-white/30 uppercase">
                {vehicle.previous_reg}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 3: Type ── */}
      <div className="flex-1 min-w-0 flex sm:hidden lg:flex items-center px-2">
        <p className="text-[10px] font-semibold sm:font-bold sm:text-[12px] text-ts-text-3 tracking-[0.2em] word-break uppercase">
          {vehicle.vehicle_type}
        </p>
      </div>

      {/* ── SECTION 4: Status Cluster ── */}
      <div className="ml-auto shrink-0 flex items-center gap-3">
        {vehicle.times_ridden > 0 && (
          <span className="text-[11px] font-black text-white/20 tabular-nums font-mono mr-1">
            ×{vehicle.times_ridden}
          </span>
        )}

        <div
          className={`flex items-center justify-center p-2 sm:px-3 sm:py-2 rounded-xl border transition-all ${
            vehicle.ridden
              ? "bg-[#1e3a1e]/30 text-[#4ade80] border-[#2d5a2d]/50"
              : "bg-white/[0.03] text-white/20 border-white/[0.05]"
          }`}
        >
          {vehicle.ridden
            ? <CheckCircle2 size={14} strokeWidth={2.5} />
            : <CircleDashed size={14} strokeWidth={2} />
          }
          <span className="hidden sm:inline ml-2 text-[10px] font-black uppercase tracking-widest">
            {vehicle.ridden ? "ridden" : "unridden"}
          </span>
        </div>

        {vehicle.withdrawn && (
          <div className="px-2.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#3a1e1e]/40 text-[#f87171] border border-[#5a2d2d]/50">
            <span className="hidden sm:inline">withdrawn</span>
            <span className="sm:hidden text-[9px]">W/D</span>
          </div>
        )}
      </div>
    </div>
  );
}