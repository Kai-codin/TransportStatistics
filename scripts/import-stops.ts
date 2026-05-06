import { ConvexHttpClient } from "convex/browser";
import fs from "fs";
import path from "path";
// 1. Import the generated API
import { api } from "../convex/_generated/api"; 

// 2. Initialize Client
const client = new ConvexHttpClient(process.env.CONVEX_DEPLOYMENT_URL!);
const CONCURRENCY_LIMIT = 5; // Process 5 batches at once
const BATCH_SIZE = 100;

async function runImport() {
  // 3. Read File
  const filePath = path.join(__dirname, "../JSON/stops.JSON");
  console.log(`Reading: ${filePath}`);
  
  const raw = fs.readFileSync(filePath, "utf8");

  // Fix invalid JSON tokens
  const cleaned = raw
    .replace(/\bNaN\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Inf\b/g, "null");

  const rawData = JSON.parse(cleaned);
  // Support both direct array or FeatureCollection objects
  const features = rawData.features || rawData; 
  
  // 4. Batching
  const tasks = [];
  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);
    
    // Add the promise to our queue
    const task = client.mutation(api.functions.import.importBatch, { features: batch })
      .then(() => console.log(`Finished batch starting at ${i}`))
      .catch((e) => console.error(`Failed batch at ${i}`, e));
    
    tasks.push(task);

    // If we hit our concurrency limit, wait for the oldest one to finish
    if (tasks.length >= CONCURRENCY_LIMIT) {
      await Promise.race(tasks);
      // Remove finished tasks (basic implementation)
      // Note: For complex queues, consider using a library like 'p-limit'
    }
  }
  await Promise.all(tasks);
  console.log("Import Complete!");
}

runImport();