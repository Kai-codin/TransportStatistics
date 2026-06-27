"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MapPin, LoaderCircle, MapPinOff } from "lucide-react";
import { useState } from "react";

type Props = {
  tripId: Id<"tripLogs">;
  tripUserId: string;
};

export function IWasHereButton({ tripId, tripUserId }: Props) {
  const isParticipating = useQuery(api.functions.friends.getMyParticipationStatus, { tripId });
  const mark = useMutation(api.functions.friends.markTripParticipation);
  const remove = useMutation(api.functions.friends.removeTripParticipation);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      if (isParticipating) {
        await remove({ tripId });
      } else {
        await mark({ tripId });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const btnClass = "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all disabled:opacity-50";

  if (isParticipating) {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className={`${btnClass} border border-ts-accent/30 bg-ts-accent/10 text-ts-accent hover:border-ts-accent/50 hover:bg-ts-accent/20`}
      >
        {loading ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <MapPinOff className="h-4 w-4" />
        )}
        Remove "I Was Here"
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`${btnClass} border border-ts-border bg-ts-surface-2 text-ts-text-1 hover:border-ts-accent/50 hover:bg-ts-accent/10 hover:text-ts-accent`}
    >
      {loading ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : (
        <MapPin className="h-4 w-4" />
      )}
      I Was Here
    </button>
  );
}
