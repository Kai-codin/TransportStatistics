// convex/crons.ts
import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync train details",
  { seconds: 10 },
  api.functions.trains.syncAllTrains,
);

export default crons;