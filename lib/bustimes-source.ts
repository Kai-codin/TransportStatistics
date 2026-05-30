import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const DEFAULT_BUSTIMES_BASE_URL = "https://bustimes.org";

export type BustimesSourceFeature =
  | "vehicleSearch"
  | "fleet"
  | "routes"
  | "departures"
  | "tripLookup"
  | "routeInfo"
  | "liveVehicles";

export async function getBustimesBaseUrl(
  feature: BustimesSourceFeature,
  userId?: string | null,
) {
  let clerkId = userId ?? null;

  if (!clerkId) {
    try {
      const authResult = await auth();
      clerkId = authResult.userId ?? null;
    } catch {
      clerkId = null;
    }
  }

  if (!clerkId) return DEFAULT_BUSTIMES_BASE_URL;

  try {
    return await fetchQuery(api.functions.userSettings.getBustimesSourceForUser, {
      clerkId,
      feature,
    });
  } catch (error) {
    console.error("Failed to resolve Bustimes source", error);
    return DEFAULT_BUSTIMES_BASE_URL;
  }
}

export function buildBustimesUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
