'use client';

interface TripRowProps {
  trip: any;
}

export const TripRow = ({ trip }: TripRowProps) => {
  const isRail = trip.transport_type === 'Rail';

  const getTypePillClasses = (type: string) => {
    switch (type) {
      case 'Rail': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
      case 'Bus':  return 'bg-orange-500/15 text-orange-400 border-orange-500/20';
      case 'Tram': return 'bg-purple-500/15 text-purple-400 border-purple-500/20';
      default:     return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
    }
  };

  const getLiveryColAccent = (type: string) => {
    switch (type) {
      case 'Rail': return 'border-r-emerald-500/20';
      case 'Bus':  return 'border-r-orange-500/20';
      case 'Tram': return 'border-r-purple-500/20';
      default:     return 'border-r-blue-500/20';
    }
  };

  const unitLabel = trip.unit_number || trip.unit_reg || trip.unit_type || '—';
  const subLabel  = isRail ? trip.unit_type : trip.livery_name;

  return (
    <div className="rounded-md flex bg-ts-surface border border-ts-border rounded-[--color-ts-r-sm] overflow-hidden hover:border-ts-border-soft transition-colors">

      {/* Livery Column */}
      <div className={`rounded-r-md w-20 shrink-0 flex flex-col items-center justify-center gap-1.5 py-2.5 bg-ts-surface-2 border-r border-r-2 border-ts-border ${getLiveryColAccent(trip.transport_type)}`}>
        {trip.livery_css ? (
          <div
            className="w-[40px] aspect-18/12 border border-ts-border-soft shrink-0"
            style={{ background: trip.livery_css }}
            title={trip.livery_name || 'Livery'}
          />
        ) : (
          <div className="w-[40px] aspect-18/12 border border-dashed border-ts-border shrink-0" />
        )}
        <span className="font-mono text-[10px] text-ts-text-3 text-center leading-tight px-1">
          {unitLabel}
        </span>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-center gap-1 px-3.5 py-2.5 min-w-0">

        {/* Top Row: type pill + service number + operator */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0 ${getTypePillClasses(trip.transport_type)}`}>
            {trip.transport_type || 'Unknown'}
          </span>
          <span className="font-mono text-[11px] font-medium text-ts-text-2 bg-ts-surface-3 border border-ts-border px-1.5 py-0.5 rounded shrink-0">
            {trip.service_number || '—'}
          </span>
          <span className="text-[11px] text-ts-text-3 truncate">
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
          <span className="text-[13px] text-ts-text-2 truncate shrink min-w-0">
            {trip.destination_name}
          </span>
        </div>

      </div>

    </div>
  );
};