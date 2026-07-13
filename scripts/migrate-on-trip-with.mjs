import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL env var.");
  process.exit(1);
}

const client = new ConvexHttpClient(url);

async function run() {
  let cursor = null;
  let rounds = 0;

  while (true) {
    rounds++;
    const args = cursor ? { cursor } : {};
    const result = await client.mutation(api.functions.migrations.migrateOnTripWith, args);

    console.log(
      `[Round ${rounds}] processed=${result.tripsProcessed} ` +
      `created=${result.participantsCreated} updated=${result.participantsUpdated} ` +
      `skipped=${result.participantsSkipped} notFound=${result.usernamesNotFound}`
    );

    if (result.isDone) {
      console.log("\nMigration complete!");
      break;
    }

    cursor = result.nextCursor;
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
