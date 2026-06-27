import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { notFound } from "next/navigation";
import { TripDetailsClient } from "./TripDetailsClient";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default async function TripDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();

  if (!userId || !id) notFound();

  // Try fetching as owner first
  let tripData = await convex.query(api.functions.trips.getTripDetailsById, {
    tripId: id as Id<"tripLogs">,
    userId,
  });

  if (tripData) {
    return <TripDetailsClient data={tripData} isOwner={true} />;
  }

  // Try fetching as friend/viewer
  tripData = await convex.query(api.functions.trips.getTripDetailsByIdNoAuth, {
    tripId: id as Id<"tripLogs">,
  });

  if (!tripData) notFound();

  // Check if viewer can access this profile
  const accessCheck = await convex.query(api.functions.friends.canViewProfile, {
    targetUserId: tripData.trip.user,
    viewerUserId: userId,
  });

  if (!accessCheck.allowed) notFound();

  return <TripDetailsClient data={tripData} isOwner={false} />;
}
