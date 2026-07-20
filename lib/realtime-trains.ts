import { fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';

export type VehicleAllocation = Record<string, { unit_number: string; unit_type: string; livery: string; livery_left: string }>;

export async function getTrainAllocation(uid: string, date: string): Promise<VehicleAllocation> {
  const cached = await fetchQuery(api.functions.trains.getAllocationByUidDate, { uid, date });
  if (cached?.unit_allocation) {
    return cached.unit_allocation as VehicleAllocation;
  }
  return {};
}