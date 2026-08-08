import { fetchQuery, fetchMutation } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';

export type VehicleAllocation = Record<string, { unit_number: string; unit_type: string; livery: string; livery_left: string }>;

export async function getTrainAllocation(uid: string, date: string): Promise<VehicleAllocation> {
  const cached = await fetchQuery(api.functions.trains.getAllocationByUidDate, { uid, date });
  if (cached?.unit_allocation) {
    return cached.unit_allocation as VehicleAllocation;
  }
  return {};
}

function parseAllocationData(rttData: any): VehicleAllocation {
  const allocationData = rttData?.allocationData ?? rttData?.service?.allocationData;
  if (!allocationData || !Array.isArray(allocationData)) return {};

  const result: VehicleAllocation = {};
  for (const alloc of allocationData) {
    const index = alloc.allocationIndex ?? 0;
    const leadingClass = alloc.leadingClass || null;
    const items = alloc.allocationItems;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (item.stockType === "unit" && item.identity) {
        result[String(index)] = {
          unit_number: item.identity,
          unit_type: leadingClass || item.identity.replace(/\d+$/, "") || "Unknown",
          livery: "",
          livery_left: "",
        };
      }
    }
  }
  return result;
}

async function enrichAllocationWithLiveries(allocation: VehicleAllocation): Promise<VehicleAllocation> {
  const unitNumbers = Object.values(allocation).map((a) => a.unit_number).filter(Boolean);
  if (unitNumbers.length === 0) return allocation;

  try {
    const unitDetails = await fetchQuery(api.functions.trains.getUnitsByNumbers, { unitNumbers });
    const detailsMap = new Map<string, (typeof unitDetails)[number]>();
    for (const detail of unitDetails) {
      if (detail?.unit_number) {
        detailsMap.set(detail.unit_number, detail);
      }
    }

    for (const key of Object.keys(allocation)) {
      const unitNum = allocation[key].unit_number;
      const detail = unitNum ? detailsMap.get(unitNum) : null;
      if (detail) {
        if (detail.livery_name) allocation[key].livery = detail.livery_name;
        if (detail.livery_css) allocation[key].livery_left = detail.livery_css;
        if (detail.type_name) allocation[key].unit_type = detail.type_name;
      }
    }
  } catch (e) {
    console.error('[Allocation] Failed to enrich liveries:', e);
  }

  return allocation;
}

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

export async function getRTTToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  const response = await fetch('https://data.rtt.io/api/get_access_token', {
    headers: { 'Authorization': `Bearer ${process.env.RTT_REFRESH_TOKEN}` },
  });

  if (!response.ok) {
    throw new Error(`AUTH_FAILURE: Failed to refresh RTT token (${response.status})`);
  }

  const data = await response.json();
  cachedToken = data.token;
  tokenExpiry = new Date(data.validUntil).getTime();
  return cachedToken!;
}

export async function fetchAllocationFromRTT(
  uid: string,
  date: string,
  rttData?: any,
): Promise<VehicleAllocation> {
  const cached = await fetchQuery(api.functions.trains.getAllocationByUidDate, { uid, date });
  if (cached?.unit_allocation) {
    return cached.unit_allocation as VehicleAllocation;
  }
  console.log(`[Allocation] Cache miss for ${uid}/${date}`);

  try {
    let data = rttData;
    if (!data) {
      const token = await getRTTToken();
      const rttUrl = `https://data.rtt.io/gb-nr/service?uniqueIdentity=${uid}:${date}&detailed=true`;
      const res = await fetch(rttUrl, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) {
        console.error(`[Allocation] RTT fetch failed: ${res.status} for ${uid}/${date}`);
        return {};
      }
      data = await res.json();
    }

    let allocation = parseAllocationData(data);

    allocation = await enrichAllocationWithLiveries(allocation);

    if (Object.keys(allocation).length === 0) return {};

    const unitNumbers = Object.values(allocation).map((a) => a.unit_number).filter(Boolean);

    await fetchMutation(api.functions.trains.saveAllocationByUidDate, {
      uid,
      date,
      unit_numbers: unitNumbers,
      unit_allocation: allocation,
    });

    return allocation;
  } catch (e) {
    console.error(`Failed to fetch allocation for ${uid}/${date}:`, e);
    return {};
  }
}
