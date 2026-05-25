import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL env var.");
  process.exit(1);
}

const client = new ConvexHttpClient(url, {
  fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
});

const MAX_DELETES = Number.parseInt(process.env.MAX_DELETES ?? "50", 10);
const MAX_ROUNDS = Number.parseInt(process.env.MAX_ROUNDS ?? "20", 10);
const SLEEP_MS = Number.parseInt(process.env.SLEEP_MS ?? "250", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  let totalDeleted = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await client.mutation(api.functions.trains.cleanupOldtrainDetails, {
      maxDeletes: MAX_DELETES,
    });
    totalDeleted += result?.deleted ?? 0;
    console.log(
      `Round ${round + 1}: deleted ${result?.deleted ?? 0}, scanned ${result?.scanned ?? 0}`
    );
    if (!result?.deleted) break;
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }
  console.log(`Done. Total deleted: ${totalDeleted}`);
}

run().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
