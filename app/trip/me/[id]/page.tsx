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

  const tripData = await convex.query(api.functions.trips.getTripDetailsById, {
    tripId: id as Id<"tripLogs">,
    userId,
  });

  if (!tripData) notFound();

  return <TripDetailsClient data={tripData} />;
}