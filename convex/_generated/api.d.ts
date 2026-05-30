/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as functions_admin from "../functions/admin.js";
import type * as functions_completion from "../functions/completion.js";
import type * as functions_delete_stop_of_type from "../functions/delete_stop_of_type.js";
import type * as functions_editRequests from "../functions/editRequests.js";
import type * as functions_import from "../functions/import.js";
import type * as functions_liveries from "../functions/liveries.js";
import type * as functions_migrations from "../functions/migrations.js";
import type * as functions_operators from "../functions/operators.js";
import type * as functions_publicRelations from "../functions/publicRelations.js";
import type * as functions_seed from "../functions/seed.js";
import type * as functions_stats from "../functions/stats.js";
import type * as functions_stops from "../functions/stops.js";
import type * as functions_trains from "../functions/trains.js";
import type * as functions_trips from "../functions/trips.js";
import type * as functions_userSettings from "../functions/userSettings.js";
import type * as functions_users from "../functions/users.js";
import type * as functions_vehicles from "../functions/vehicles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "functions/admin": typeof functions_admin;
  "functions/completion": typeof functions_completion;
  "functions/delete_stop_of_type": typeof functions_delete_stop_of_type;
  "functions/editRequests": typeof functions_editRequests;
  "functions/import": typeof functions_import;
  "functions/liveries": typeof functions_liveries;
  "functions/migrations": typeof functions_migrations;
  "functions/operators": typeof functions_operators;
  "functions/publicRelations": typeof functions_publicRelations;
  "functions/seed": typeof functions_seed;
  "functions/stats": typeof functions_stats;
  "functions/stops": typeof functions_stops;
  "functions/trains": typeof functions_trains;
  "functions/trips": typeof functions_trips;
  "functions/userSettings": typeof functions_userSettings;
  "functions/users": typeof functions_users;
  "functions/vehicles": typeof functions_vehicles;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
