import { mutation } from "../_generated/server";

const STOP_TYPES_DATA = [
  { name: "Airport Access Area", code: "GAT" },
  { name: "Airport Entrance", code: "AIR" },
  { name: "Bus Coach on street", code: "BCT" },
  { name: "Bus or Coach Station Access Area", code: "BST" },
  { name: "Bus or Coach Station Bay", code: "BCQ" },
  { name: "Bus or Coach Station Bay", code: "BCS" },
  { name: "Bus or Coach Station Entrance", code: "BCE" },
  { name: "Ferry Port Access Area", code: "FER" },
  { name: "Ferry Port Bay", code: "FBT" },
  { name: "Ferry Port Entrance", code: "FTD" },
  { name: "Metro Station Access Area", code: "MET" },
  { name: "Metro Station Entrance", code: "TMU" },
  { name: "Metro Station Platform", code: "PLT" },
  { name: "Rail Station Access Area", code: "RLY" },
  { name: "Rail Station Entrance", code: "RSE" },
  { name: "Rail Station Platform", code: "RPL" },
  { name: "Rail Stations", code: "RLS" },
  { name: "Shared Taxi Rank", code: "STR" },
  { name: "Taxi Rank Bay", code: "TXR" },
  // Sub-types
  { name: "Bus Coach on street Bay", code: "MKD", subOf: "BCT" },
  { name: "Bus Coach on street Bay", code: "CUS", subOf: "BCT" },
  { name: "Bus Coach on street Bay", code: "HAR", subOf: "BCT" },
  { name: "Bus Coach on street Bay", code: "FLX", subOf: "BCT" },
];

export const seedStopTypes = mutation(async ({ db }) => {
  for (const item of STOP_TYPES_DATA) {
    // 1. Check if it already exists by code
    const existing = await db
      .query("stopTypes")
      .withIndex("by_code", (q) => q.eq("code", item.code))
      .unique();

    let subOfId = undefined;

    // 2. Resolve subOf ID if applicable
    if (item.subOf) {
      const parent = await db
        .query("stopTypes")
        .withIndex("by_code", (q) => q.eq("code", item.subOf!))
        .unique();
      subOfId = parent?._id;
    }

    // 3. Upsert (Insert if new, update if exists)
    const doc = {
      name: item.name,
      code: item.code,
      subOf: subOfId,
    };

    if (existing) {
      await db.patch(existing._id, doc);
    } else {
      await db.insert("stopTypes", doc as any);
    }
  }
});