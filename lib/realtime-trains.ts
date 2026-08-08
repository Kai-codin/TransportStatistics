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
  const allocationData = rttData?.allocationData;
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
          unit_type: leadingClass || "Unknown",
          livery: "",
          livery_left: "",
        };
      }
    }
  }
  return result;
}

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getRTTToken(): Promise<string> {
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

export async function fetchAllocationFromRTT(uid: string, date: string): Promise<VehicleAllocation> {
  const cached = await fetchQuery(api.functions.trains.getAllocationByUidDate, { uid, date });
  if (cached?.unit_allocation) {
    return cached.unit_allocation as VehicleAllocation;
  }

  try {
    const token = await getRTTToken();
    const rttUrl = `https://data.rtt.io/gb-nr/service?uniqueIdentity=${uid}:${date}&detailed=true`;
    const res = await fetch(rttUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return {};
    const data = await res.json();

    const allocation = parseAllocationData(data);
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

export async function saveAllocationFromRTTResponse(uid: string, date: string, rttData: any): Promise<void> {
  const existing = await fetchQuery(api.functions.trains.getAllocationByUidDate, { uid, date });
  if (existing?.unit_allocation) return;

  const allocation = parseAllocationData(rttData);
  if (Object.keys(allocation).length === 0) return;

  const unitNumbers = Object.values(allocation).map((a) => a.unit_number).filter(Boolean);

  await fetchMutation(api.functions.trains.saveAllocationByUidDate, {
    uid,
    date,
    unit_numbers: unitNumbers,
    unit_allocation: allocation,
  });
}
