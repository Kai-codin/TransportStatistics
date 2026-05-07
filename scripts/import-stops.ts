import { ConvexHttpClient } from "convex/browser";
import fs from "fs";
import path from "path";
import { api } from "../convex/_generated/api";

const client = new ConvexHttpClient(process.env.CONVEX_DEPLOYMENT_URL!);

const CONCURRENCY_LIMIT = 3;  // Reduced — high concurrency was hammering Convex
const BATCH_SIZE = 50;        // Reduced — smaller batches = less likely to timeout
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 1000;   // 1s, 2s, 4s, 8s, 16s

// Errors worth retrying (transient) vs errors that will never recover (schema/logic)
function isRetryable(e: any): boolean {
  const code = e?.code ?? "";
  const message = e?.message ?? "";
  return (
    code === "SystemTimeoutError" ||
    code === "RateLimitError" ||
    message.includes("timed out") ||
    message.includes("rate limit")
  );
}

async function importBatchWithRetry(
  batch: any[],
  batchStart: number,
  retries = 0
): Promise<{ inserted: number; updated: number; skipped: number }> {
  try {
    return await client.mutation(api.functions.import.importBatch, {
      features: batch,
    });
  } catch (e: any) {
    if (isRetryable(e) && retries < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, retries);
      console.warn(
        `⟳ Batch @${batchStart} retry ${retries + 1}/${MAX_RETRIES} in ${delay}ms — ${e?.code ?? e?.message}`
      );
      await new Promise((res) => setTimeout(res, delay));
      return importBatchWithRetry(batch, batchStart, retries + 1);
    }
    throw e; // Non-retryable or out of retries — propagate
  }
}

async function runImport() {
  const filePath = path.join(__dirname, "../JSON/stops.JSON");
  console.log(`Reading: ${filePath}`);

  const raw = fs.readFileSync(filePath, "utf8");
  const cleaned = raw
    .replace(/:\s*NaN\b/g, ": null")
    .replace(/:\s*Infinity\b/g, ": null")
    .replace(/:\s*-Infinity\b/g, ": null");

  let rawData: any;
  try {
    rawData = JSON.parse(cleaned);
    console.log("JSON parsed OK");
  } catch (e) {
    console.error("JSON parse failed:", e);
    process.exit(1);
  }

  try {
    const test = await client.mutation(api.functions.import.importBatch, { features: [] });
    console.log("Convex connection OK:", test);
  } catch (e: any) {
    console.error("Convex connection failed:", JSON.stringify(e));
    process.exit(1);
  }

  const features: any[] = rawData.features ?? rawData;
  const batches: any[][] = [];
  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    batches.push(features.slice(i, i + BATCH_SIZE));
  }
  console.log(`Total stops: ${features.length} → ${batches.length} batches (size=${BATCH_SIZE})`);

  let completed = 0;
  let failed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  const executing = new Set<Promise<void>>();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchStart = i * BATCH_SIZE;

    const task: Promise<void> = importBatchWithRetry(batch, batchStart)
      .then((result) => {
        completed++;
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        if (completed % 25 === 0 || completed === batches.length) {
          console.log(
            `[${completed}/${batches.length}] @${batchStart} — ` +
            `+${result.inserted} ~${result.updated} skip=${result.skipped} | ` +
            `total: inserted=${totalInserted} updated=${totalUpdated}`
          );
        }
      })
      .catch((e) => {
        failed++;
        console.error(
          `✗ Batch @${batchStart} permanently failed:`,
          JSON.stringify(e)
        );
      })
      .finally(() => executing.delete(task));

    executing.add(task);
    if (executing.size >= CONCURRENCY_LIMIT) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  console.log(`\n✓ Import complete`);
  console.log(`  Batches: ${completed} OK, ${failed} failed`);
  console.log(`  Stops:   inserted=${totalInserted} updated=${totalUpdated} skipped=${totalSkipped}`);
}

runImport();