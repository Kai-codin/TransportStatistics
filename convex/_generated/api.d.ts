/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as functions_import from "../functions/import.js";
import type * as functions_import_trips from "../functions/import_trips.js";
import type * as functions_seed from "../functions/seed.js";
import type * as functions_stops from "../functions/stops.js";
import type * as functions_trains from "../functions/trains.js";
import type * as functions_trips from "../functions/trips.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "functions/import": typeof functions_import;
  "functions/import_trips": typeof functions_import_trips;
  "functions/seed": typeof functions_seed;
  "functions/stops": typeof functions_stops;
  "functions/trains": typeof functions_trains;
  "functions/trips": typeof functions_trips;
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
