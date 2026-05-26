import * as cheerio from 'cheerio';
import { fetchMutation, fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';

// Define the Types based on your requested JSON
export type EnrichedVehicle = {
  unit_number: string;
  unit_type: string;
  livery: string;
  livery_left: string;
};

export type VehicleAllocation = Record<string, EnrichedVehicle>;

export async function getTrainAllocation(uid: string, date: string): Promise<VehicleAllocation> {
  console.log(`Fetching allocation for train UID: ${uid} on date: ${date}`);
  // Setup our default fallback for 404s or empty data
  const unknownFallback: VehicleAllocation = {
    "0": {
      unit_number: "unknown",
      unit_type: "Unknown",
      livery: "Unknown",
      livery_left: ""
    }
  };

  const cached = await fetchQuery(api.functions.trains.getAllocationByUidDate, { uid, date });
  if (cached?.unit_allocation) {
    console.log(`RTT allocation cache hit for ${uid} on ${date}`);
    return cached.unit_allocation as VehicleAllocation;
  }

  console.log(`RTT allocation cache miss for ${uid} on ${date}. Calling RTT.`);

  try {
    const url = `https://www.realtimetrains.co.uk/service/gb-nr:${uid}/${date}/detailed`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      console.warn(`RTT fetch failed for ${url} with status: ${response.status}`);
      await fetchMutation(api.functions.trains.saveAllocationByUidDate, {
        uid,
        date,
        unit_numbers: ["unknown"],
        unit_allocation: unknownFallback,
      });
      return unknownFallback;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const allocationText = $('.op').text();
    const allocationLines = $('.allocation li')
      .map((_i, el) => $(el).text())
      .get()
      .map((line) => line.trim())
      .filter(Boolean);

    const extractUnitNumbers = (lines: string[]) => {
      const combined = lines.join(' ');
      const matches = combined.match(/\b\d{3,}\b/g) ?? [];
      const seen = new Set<string>();
      return matches.filter((unit) => {
        if (seen.has(unit)) return false;
        seen.add(unit);
        return true;
      });
    };

    const unitNumbersFromAllocation = allocationLines.length > 0
      ? extractUnitNumbers(allocationLines)
      : [];
    const unitNumbersFromOp = allocationText
      ? extractUnitNumbers([allocationText])
      : [];
    const unitNumbersRaw = unitNumbersFromAllocation.length > 0
      ? unitNumbersFromAllocation
      : unitNumbersFromOp;

    if (unitNumbersRaw.length === 0) {
      await fetchMutation(api.functions.trains.saveAllocationByUidDate, {
        uid,
        date,
        unit_numbers: ["unknown"],
        unit_allocation: unknownFallback,
      });
      return unknownFallback;
    }

    // 1. Scrape the raw unit numbers
    const unitNumbers = unitNumbersRaw;
    
    // 2. Send the raw array to Convex to be enriched 
    // (This requires the getDetailsByUnits query we made in the previous step)
    const enrichedVehicles = await fetchQuery(api.functions.vehicles.getDetailsByUnits, {
      unitNumbers: unitNumbers
    });

    const allocation = enrichedVehicles && Object.keys(enrichedVehicles).length > 0
      ? enrichedVehicles
      : unknownFallback;
    const unitNumbersToStore = unitNumbers.length > 0 ? unitNumbers : ["unknown"];

    await fetchMutation(api.functions.trains.saveAllocationByUidDate, {
      uid,
      date,
      unit_numbers: unitNumbersToStore,
      unit_allocation: allocation,
    });

    console.log("Enriched Vehicles:", allocation);
    return allocation;
    
  } catch (error) {
    console.error("Error fetching allocation:", error);

    console.warn(`Returning unknown fallback for UID: ${uid} on date: ${date}`);
    await fetchMutation(api.functions.trains.saveAllocationByUidDate, {
      uid,
      date,
      unit_numbers: ["Unknown"],
      unit_allocation: unknownFallback,
    });
    return unknownFallback;
  }
}