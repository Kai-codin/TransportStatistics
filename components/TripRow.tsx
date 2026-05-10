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
  const primaryUnit = Array.isArray(trip.units)
    ? trip.units.find((unit) =>
        unit && (unit.unit_number || unit.unit_reg || unit.unit_type || unit.livery || unit.livery_left)
      )
    : null;

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

  const liveryCss = primaryUnit?.livery_left || trip.livery_css;
  const liveryName = primaryUnit?.livery || trip.livery_name;
  const unitType = primaryUnit?.unit_type || trip.unit_type;
  const unitNumber = primaryUnit?.unit_number || trip.unit_number;
  const unitReg = primaryUnit?.unit_reg || trip.unit_reg;
  const hasUnit = unitNumber || unitReg;
  const label = [unitNumber, unitReg].filter(Boolean).join(' - ');

  return (
    <div className="flex bg-ts-surface border border-ts-border rounded-[--color-ts-r-sm] overflow-hidden hover:border-ts-border-soft transition-colors rounded-lg">

      {/* Vehicle Details Column */}
      <div className="w-44 shrink-0 flex bg-ts-surface-2">
        {/* Accent strip */}
        <div className="flex-1 flex flex-col justify-center gap-2 px-3 py-3">

        {/* Livery swatch + name */}
        <div className="flex items-center gap-2.5">
          {liveryCss ? (
            <>
              <div
                className="w-10 aspect-24/16 border border-ts-border-soft shrink-0"
                style={{ background: liveryCss }}
                role="img"
                aria-label={liveryName || 'Livery'}
              />
              <span className="text-[10px] font-medium text-ts-text-2 leading-tight line-clamp-2">
                {liveryName}
              </span>
            </>
          ) : (
            <div className="w-10 h-[26px] rounded-sm border border-dashed border-ts-border shrink-0" />
          )}
        </div>

        {/* Divider */}
        {hasUnit && (
          <div className="border-t border-ts-border" />
        )}

        {/* Unit number + reg stacked */}
        {hasUnit && (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] font-semibold text-ts-text-1 leading-none tracking-wide">
              {label}
            </span>
            {unitType && (
              <span className="text-[9px] text-ts-text-2 leading-tight mt-0.5 truncate">
                {unitType}
              </span>
            )}
          </div>
        )}

        </div>
        <div className={`w-[3px] shrink-0 ${getAccentColor(trip.transport_type)}`} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-center gap-2 px-3.5 py-2.5 min-w-0">

        {/* Top Row: type pill + service number + operator */}
        <div className="flex items-center gap-2 min-w-0">          
          <span className={`font-mono text-[13px] font-medium px-1.5 py-0.5 rounded shrink-0 ${getTypePillClasses(trip.transport_type)}`}>
            {trip.service_number || '—'}
          </span>
          <span className="text-[12px] text-ts-text-3 truncate">
            {trip.operator}
          </span>
        </div>

        {/* Bottom Row: time + route */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-sm font-bold text-ts-text-1 tabular-nums shrink-0 leading-none">
            {trip.scheduled_departure ? trip.scheduled_departure.substring(0, 5) : '--:--'}
          </span>
          <span className="text-ts-border-soft shrink-0 text-sm">·</span>
          <span className="text-[13px] font-medium text-ts-text-1 truncate shrink min-w-0">
            {trip.origin_name}
          </span>
          <span className="text-ts-text-3 shrink-0 text-xs">→</span>
          <span className="text-[13px] font-medium text-ts-text-1 truncate shrink min-w-0">
            {trip.destination_name}
          </span>
        </div>

      </div>

    </div>
  );
};
