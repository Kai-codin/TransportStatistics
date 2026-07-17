'use client';

import Link from 'next/link';

type TripUnit = {
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery?: string;
  livery_left?: string;
};

type TripLike = {
  _id: string;
  transport_type: string;
  service_number?: string;
  operator?: string;
  scheduled_departure?: string;
  origin_name?: string;
  origin_stop_code?: string;
  destination_name?: string;
  destination_stop_code?: string;
  units?: TripUnit[];
  unit_number?: string;
  unit_reg?: string;
  unit_type?: string;
  livery_name?: string;
  livery_css?: string;
  first_time?: boolean;
  first_units?: string[];
};

interface CompactTripRowProps {
  trip: TripLike;
}

export const CompactTripRow = ({ trip }: CompactTripRowProps) => {
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

  const unit = allUnits[0];
  const unitLabel = [unit?.unit_number, unit?.unit_reg]
    .filter(v => v && v !== '—' && v !== '-')
    .join(' - ') || 'Unknown';

  const originLabel = trip.origin_name;
  const destLabel = trip.destination_name;

  return (
    <Link href={`/trip/me/${trip._id}`}>
      <div className="flex items-stretch gap-3 bg-ts-surface border border-ts-border rounded-lg overflow-hidden hover:border-ts-border-soft transition-colors">
        {/* Left accent bar */}
        <div className={`w-[3px] shrink-0 ${getAccentColor(trip.transport_type)}`} />

        <div className="flex items-center gap-3 flex-1 min-w-0 py-3 pr-3">
          {/* Service pill */}
          <span className={`font-mono text-[12px] font-medium px-1.5 py-0.5 rounded shrink-0 ${getTypePillClasses(trip.transport_type)}`}>
            {trip.service_number || '-'}
          </span>

          {/* Origin -> Destination, with operator as a smaller line underneath */}
          <div className="flex flex-col gap-0 flex-1 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[13px] font-bold text-ts-text-1 truncate">
                {originLabel}
              </span>
              <span className="text-ts-text-3 shrink-0 text-xs">→</span>
              <span className="text-[13px] font-bold text-ts-text-1 truncate">
                {destLabel}
              </span>
            </div>
            <span className="text-[10px] text-ts-text-3 font-medium truncate leading-tight">
              {trip.operator}
            </span>
          </div>

          {/* Time + unit, stacked to stay narrow */}
          <div className="flex flex-col items-end shrink-0 leading-tight gap-0 w-[100px]">
            <span className="font-mono text-[13px] font-bold text-ts-text-1 tabular-nums leading-none">
              {trip.scheduled_departure ? trip.scheduled_departure.substring(0, 5) : '--:--'}
            </span>
            <span className="font-mono text-[11px] font-semibold text-ts-text-2 text-nowrap max-w-full">
              {unitLabel}
               {/* First-time star */}
              {allUnits.length > 1 && (
                <span className="text-ts-text-3 opacity-70"> +{allUnits.length - 1}</span>
              )}
            </span>
          </div>

          {/* Livery swatch */}
          {unit?.livery_left && (
            <div
              className="hidden sm:block w-9 aspect-24/16 border border-ts-border-soft shrink-0 rounded-sm"
              style={{ background: unit.livery_left }}
            />
          )}
        </div>
      </div>
    </Link>
  );
};