'use client';

type TripUnit = {
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery?: string;
  livery_left?: string;
};

type TripLike = {
  transport_type: string;
  service_number?: string;
  operator?: string;
  scheduled_departure?: string;
  origin_name?: string;
  destination_name?: string;
  units?: TripUnit[];
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery_name?: string;
  livery_css?: string;
};

interface TripRowProps {
  trip: TripLike;
}

export const TripRow = ({ trip }: TripRowProps) => {
  const allUnits = (Array.isArray(trip.units) && trip.units.length > 0
    ? trip.units
    : [{
        unit_number: trip.unit_number,
        unit_reg: trip.unit_reg,
        unit_type: trip.unit_type,
        livery: trip.livery_name,
        livery_left: trip.livery_css,
      }]
  ).flatMap(unit => {
    if (unit.unit_number?.includes(' + ')) {
      const numbers = unit.unit_number.split(' + ');
      return numbers.map(num => ({ ...unit, unit_number: num }));
    }
    return [unit];
  });

  const getTypePillClasses = (type: string) => {
    switch (type) {
      case 'Rail': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
      case 'Bus':  return 'bg-orange-500/15 text-orange-400 border-orange-500/20';
      case 'Tram': return 'bg-purple-500/15 text-purple-400 border-purple-500/20';
      default:     return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
    }
  };

  const getAccentColor = (type: string) => {
    switch (type) {
      case 'Rail': return 'bg-emerald-500/60';
      case 'Bus':  return 'bg-orange-500/60';
      case 'Tram': return 'bg-purple-500/60';
      default:     return 'bg-blue-500/60';
    }
  };

  const firstUnit = allUnits[0];
  const lastUnit = allUnits.length > 1 ? allUnits[allUnits.length - 1] : null;
  const extraCount = allUnits.length > 2 ? allUnits.length - 2 : 0;

  return (
    <div className="flex flex-col sm:flex-row bg-ts-surface border border-ts-border rounded-lg overflow-hidden hover:border-ts-border-soft transition-colors">

      {/* ── Mobile: top accent bar ── only visible below sm */}
      <div className={`h-[3px] w-full sm:hidden ${getAccentColor(trip.transport_type)}`} />

      {/* ── Vehicle Details ── */}
      {/* Desktop: left column (w-48) | Mobile: full-width horizontal strip */}
      <div className="sm:w-48 sm:shrink-0 flex sm:flex-col sm:bg-ts-surface-2 sm:border-r sm:border-ts-border/50">

        {/* Inner layout: row on mobile, column on desktop */}
        <div className="flex-1 flex flex-row sm:flex-col items-center sm:items-start justify-start sm:justify-center px-3 py-2 sm:py-3 gap-3 sm:gap-2.5">

          {/* Livery swatches */}
          <div className="flex items-center gap-1 shrink-0">
            {firstUnit?.livery_left && (
              <div
                className="w-9 sm:w-10 aspect-24/16 border border-ts-border-soft shrink-0 rounded-sm"
                style={{ background: firstUnit.livery_left }}
              />
            )}
            {lastUnit?.livery_left && (
              <div
                className="w-9 sm:w-10 aspect-24/16 border border-ts-border-soft shrink-0 rounded-sm"
                style={{ background: lastUnit.livery_left, transform: 'scaleX(-1)' }}
              />
            )}
            {extraCount > 0 && (
              <div className="px-1 h-4 flex items-center justify-center bg-ts-surface border border-ts-border rounded-[3px] text-[9px] font-bold text-ts-text-3 font-mono ml-0.5 opacity-80">
                +{extraCount}
              </div>
            )}
          </div>

          {/* Unit numbers + type */}
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-y-0.5">
              {allUnits.map((unit, idx) => (
                <span key={idx} className="font-mono text-[11px] font-semibold text-ts-text-1 leading-none tracking-wide">
                  {[unit.unit_number, unit.unit_reg]
                    .filter(v => v && v !== "—" && v !== "-")
                    .join(" - ") || "Unknown"}
                  {idx < allUnits.length - 1 && (
                    <span className="mx-0.5 text-ts-text-3 opacity-50">+</span>
                  )}
                </span>
              ))}
            </div>
            <span className="text-[10px] text-ts-text-3 leading-tight truncate">
              {allUnits[0]?.unit_type || 'Unknown Type'}
            </span>
          </div>

        </div>

        {/* Desktop right-edge accent bar */}
        <div className={`hidden sm:block w-[3px] shrink-0 ${getAccentColor(trip.transport_type)}`} />
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-3 min-w-0">

        {/* Service pill + operator */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-mono text-[13px] font-medium px-1.5 py-0.5 rounded shrink-0 ${getTypePillClasses(trip.transport_type)}`}>
            {trip.service_number || '-'}
          </span>
          <span className="text-[12px] text-ts-text-3 font-medium truncate">
            {trip.operator}
          </span>
        </div>

        {/* Time + origin → destination */}
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-mono text-sm font-bold text-ts-text-1 tabular-nums shrink-0 leading-none">
            {trip.scheduled_departure ? trip.scheduled_departure.substring(0, 5) : '--:--'}
          </span>
          <span className="text-ts-text-3/40 shrink-0 text-sm">·</span>
          {/* Origin + destination share equal space and both truncate gracefully */}
          <span className="text-[13px] font-bold text-ts-text-1 truncate flex-1 min-w-0">
            {trip.origin_name}
          </span>
          <span className="text-ts-text-3 shrink-0 text-xs">→</span>
          <span className="text-[13px] font-bold text-ts-text-1 truncate flex-1 min-w-0">
            {trip.destination_name}
          </span>
        </div>

      </div>
    </div>
  );
};