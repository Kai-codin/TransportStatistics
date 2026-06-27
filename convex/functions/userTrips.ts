import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

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

  return [...byId.values()].sort((a, b) => {
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
