import { ConvexHttpClient } from "convex/browser";
import fs from "fs";
import path from "path";
// 1. Import the generated API
import { api } from "../convex/_generated/api"; 

// 2. Initialize Client
const client = new ConvexHttpClient(process.env.CONVEX_DEPLOYMENT_URL!);

async function runImport() {
  // 3. Read File
  const filePath = path.join(__dirname, "../JSON/OSM_stops.JSON");
  console.log(`Reading: ${filePath}`);
  
  const rawData = JSON.parse(fs.readFileSync(filePath, "utf8"));
  // Support both direct array or FeatureCollection objects
  const features = rawData.features || rawData; 
  
  // 4. Batching
  const BATCH_SIZE = 250;
  for (let i = 0; i < features.length; i += BATCH_SIZE) { // Changed to 200 for better throughput
    const batch = features.slice(i, i + BATCH_SIZE);
    console.log(`Importing batch ${i / BATCH_SIZE + 1} (${batch.length} items)...`);
    
    try {
      // 5. Use the typed api reference
      await client.mutation(api.functions.import.importBatch, { features: batch });
    } catch (e) {
      console.error("Failed batch", i, e);
      // Optional: process.exit(1) if you want the script to stop on error
    }
  }
  
  console.log("Import Complete!");
}

runImport();