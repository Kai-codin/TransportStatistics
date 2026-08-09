import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { auth } from "@clerk/nextjs/server";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vehicle = searchParams.get("vehicle");

  if (!vehicle) {
    return NextResponse.json({ error: "Missing vehicle parameter" }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ridden: false, count: 0, trips: [] });
  }

  try {
    const result = await convex.query(api.functions.vehicles.checkVehicleRidden, {
      user: userId,
      vehicleIdentifier: vehicle,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[check-vehicle] error:", error);
    return NextResponse.json({ ridden: false, count: 0, trips: [] }, { status: 500 });
  }
}
