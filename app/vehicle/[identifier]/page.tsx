import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { notFound } from "next/navigation";
import { VehicleClient } from "./VehicleClient";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default async function VehiclePage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const { userId } = await auth();

  if (!userId || !identifier) notFound();

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  try {
    const vehicleData = await convex.query(api.functions.vehicles.getVehicleTrips, {
      user: userId,
      vehicleIdentifier: identifier,
      timeZone,
    });

    return <VehicleClient vehicleIdentifier={identifier} data={vehicleData} />;
  } catch (error) {
    console.error("[vehicle page] error:", error);
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <div className="rounded-3xl border border-ts-border bg-ts-surface p-8 text-center md:p-10">
          <h1 className="text-2xl font-bold text-ts-text-1 md:text-3xl">
            Error loading vehicle data
          </h1>
          <p className="mt-2 text-sm text-ts-text-3">
            Vehicle identifier: {identifier}
          </p>
        </div>
      </div>
    );
  }
}