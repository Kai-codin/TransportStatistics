import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

function normalizeServiceDate(value: number) {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function getDayNumber(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

function sortTripsDesc(trips: Doc<"tripLogs">[]): Doc<"tripLogs">[] {
  return trips.sort((a, b) => {
    const aTime = typeof a.logged_at === "number"
      ? a.logged_at
      : (a.service_date > 1_000_000_000_000 ? a.service_date : a.service_date * 1000);
    const bTime = typeof b.logged_at === "number"
      ? b.logged_at
      : (b.service_date > 1_000_000_000_000 ? b.service_date : b.service_date * 1000);

    if (aTime !== bTime) return bTime - aTime;
    return String(b._id).localeCompare(String(a._id));
  });
}

export async function getAllUserTrips(ctx: QueryCtx, userId: string): Promise<Doc<"tripLogs">[]> {
  const ownedTrips = await ctx.db
    .query("tripLogs")
    .withIndex("by_user", (q) => q.eq("user", userId))
    .collect();

  const participations = await ctx.db
    .query("tripParticipants")
    .withIndex("by_user", (q) => q.eq("user", userId))
    .collect();

  const participatedTrips = (await Promise.all(
    participations.map((p) => ctx.db.get(p.tripId))
  )).filter((trip): trip is NonNullable<typeof trip> => trip !== null);

  const byId = new Map<string, Doc<"tripLogs">>();
  for (const trip of ownedTrips) byId.set(String(trip._id), trip);
  for (const trip of participatedTrips) byId.set(String(trip._id), trip);

  return sortTripsDesc([...byId.values()]);
}

export async function getUserTripsForDateRange(
  ctx: QueryCtx,
  userId: string,
  dateKey: string,
): Promise<Doc<"tripLogs">[]> {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return [];

  const targetDay = getDayNumber(Date.UTC(year, month - 1, day, 0, 0, 0));

  const dayStartMs = targetDay * 86_400_000;
  const dayEndMs = (targetDay + 1) * 86_400_000;
  const dayStartSec = targetDay * 86_400;
  const dayEndSec = (targetDay + 1) * 86_400;

  const [ownedTripsMs, ownedTripsSec] = await Promise.all([
    ctx.db
      .query("tripLogs")
      .withIndex("by_user_service_date", (q) =>
        q.eq("user", userId).gte("service_date", dayStartMs).lt("service_date", dayEndMs),
      )
      .collect(),
    ctx.db
      .query("tripLogs")
      .withIndex("by_user_service_date", (q) =>
        q.eq("user", userId).gte("service_date", dayStartSec).lt("service_date", dayEndSec),
      )
      .collect(),
  ]);

  const byId = new Map<string, Doc<"tripLogs">>();
  for (const trip of ownedTripsMs) byId.set(String(trip._id), trip);
  for (const trip of ownedTripsSec) byId.set(String(trip._id), trip);

  const participations = await ctx.db
    .query("tripParticipants")
    .withIndex("by_user", (q) => q.eq("user", userId))
    .collect();

  const missingTrips = (await Promise.all(
    participations
      .filter((p) => !byId.has(String(p.tripId)))
      .map((p) => ctx.db.get(p.tripId)),
  )).filter((trip): trip is NonNullable<typeof trip> => trip !== null);

  for (const trip of missingTrips) {
    if (getDayNumber(normalizeServiceDate(trip.service_date)) === targetDay) {
      byId.set(String(trip._id), trip);
    }
  }

  return sortTripsDesc([...byId.values()]);
}
