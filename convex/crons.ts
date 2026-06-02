import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

const isProd = process.env.ENVIRONMENT === "production";

if (isProd) {
  crons.interval(
    "sync train details",
    { seconds: 30 },
    api.functions.trains.syncAllTrains,
    {},
  );

  crons.interval(
    "cleanup old train details (5 days)",
    { hours: 2 },
    api.functions.trains.cleanupOldtrainDetails,
    {},
  );

  crons.interval(
    "cleanup old train details summary (5 days)",
    { hours: 2 },
    api.functions.trains.cleanupOldtrainDetailsSummary,
    {},
  );
}

export default crons;