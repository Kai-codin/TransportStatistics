import { CheckCircle2, CircleDashed } from "lucide-react";
import type { Vehicle } from "../types";

export function FleetRow({ vehicle }: { vehicle: Vehicle }) {
  const currentLivery = vehicle.livery?.current_bustimes_livery;
  const previousLivery = vehicle.livery?.previous_bustimes_livery;

  return (
    <div
      className={`
        group relative flex items-center gap-5 px-5 py-3.5
        rounded-2xl border transition-all duration-150
        ${vehicle.withdrawn
          ? "bg-ts-surface border-white/[0.04] opacity-50 hover:opacity-70"
          : "bg-ts-surface border-white/[0.06] hover:bg-ts-surface-2 hover:border-white/[0.10]"
        }
      `}
    >
      {/* Livery swatches + names — each row is swatch + label side by side */}
      <div className="shrink-0 flex flex-col gap-[5px] min-w-0 sm:w-56">
        {/* Current livery */}
        <div className="flex items-center gap-2.5">
          <div
            className="shrink-0 h-6"
            style={{ background: currentLivery?.css ?? "#2a2a2a", aspectRatio: "24/16" }}
          />
          <span className="text-[11px] hidden sm:flex font-bold text-white/80 truncate leading-none tracking-tight">
            {currentLivery?.name ?? "Unknown"}
          </span>
        </div>
        {/* Previous livery */}
        {previousLivery ? (
          <div className="flex items-center gap-2.5 border-ts-border-soft pt-1 border-solid border-t">
            <div
              className="shrink-0 h-6"
              style={{ background: previousLivery.css, aspectRatio: "24/16" }}
            />
            <span className="text-[10px] hidden sm:flex font-medium text-white/35 truncate leading-none tracking-tight">
              {previousLivery.name}
            </span>
          </div>
        ) : (
          /* spacer so rows without a previous livery don't collapse height unevenly */
          <div className="h-4" />
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-5 shrink-0 min-w-[4.5rem] sm:w-auto">
        {/* Fleet number */}
        <span className="font-mono font-black text-[17px] text-[var(--color-ts-text-1)] tabular-nums leading-none">
          {vehicle.unit_number}
        </span>

        {/* Reg plate */}
        <span className="shrink-0 inline-block bg-[#f5c518] text-black font-black text-[10px] sm:text-[11px] px-2 sm:px-3 py-[2px] sm:py-[3px] rounded-md tracking-widest uppercase font-mono leading-none w-fit">
          {vehicle.reg}
        </span>
      </div>

      {/* Vehicle type */}
      <div className="flex-1 min-w-0 hidden lg:block">
        <p className="text-[11px] font-bold text-white/50 uppercase tracking-widest truncate">
          {vehicle.vehicle_type}
        </p>
      </div>

      {/* Right cluster */}
      <div className="ml-auto shrink-0 flex items-center gap-3">
        {vehicle.times_ridden > 0 && (
          <span className="text-[11px] font-black text-white/35 tabular-nums font-mono">
            ×{vehicle.times_ridden}
          </span>
        )}

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${
            vehicle.ridden
              ? "bg-[#1e3a1e] text-[#4ade80] border-[#2d5a2d]/60"
              : "bg-white/[0.04] text-white/30 border-white/[0.07]"
          }`}
        >
          {vehicle.ridden
            ? <CheckCircle2 size={10} strokeWidth={2.5} />
            : <CircleDashed size={10} strokeWidth={2} />
          }
          {vehicle.ridden ? "ridden" : "unridden"}
        </div>

        {vehicle.withdrawn && (
          <div className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-[#3a1e1e] text-[#f87171] border border-[#5a2d2d]/60">
            withdrawn
          </div>
        )}
      </div>
    </div>
  );
}