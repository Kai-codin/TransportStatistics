# Transport Statistics

Transport Statistics is a Next.js 16 application for exploring UK rail and bus data, logging trips, inspecting operators and vehicles, and rendering live transit information on a MapLibre map. It uses Convex for app data, Clerk for authentication, Redis-backed rate limiting where enabled, and a set of server routes that proxy external transport services.

## What It Does

- Live map views for vehicles and route geometry.
- Departure boards for rail and bus stops.
- Trip logging and historical service views.
- Vehicle and operator lookup pages.
- Admin and profile flows backed by Clerk and Convex.
- Same-origin internal API calls for the web app, with API-key protected access for external apps.

## Stack

- Next.js 16 App Router
- React 19
- Clerk authentication
- Convex backend queries
- MapLibre GL for mapping
- Redis and `rate-limiter-flexible` for API throttling
- TypeScript

## Getting Started

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build

```bash
npm run build
```

### Start production server

```bash
npm run start
```

### Lint

```bash
npm run lint
```

## Environment Variables

The app expects these values in the environment:

- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL used by the client and API routes.
- `CONVEX_DEPLOYMENT_URL` - Used by scripts such as `scripts/import-stops.ts`.
- `CLERK_HOSTNAME` - Hostname used by Clerk auth config.
- `REDIS_URL` - Redis connection string for API rate limiting.
- `DISABLE_REDIS` or `REDIS_DISABLED` - Disable Redis and fall back to in-memory rate limiting.
- `RTT_REFRESH_TOKEN` - Token used to fetch RealTimeTrains access tokens.
- `MAPTILER_KEY` - Optional fallback map style key.

## Authentication Model

The app uses two access patterns:

- Same-origin browser requests are allowed without an API key.
- External callers must send a Clerk API key token using `Authorization: Bearer <key>`.

Shared API protection lives in [lib/api-key-auth.ts](lib/api-key-auth.ts).

## Project Structure

- `app/` - App Router pages and API routes.
- `components/` - Client-side map, stop panel, live vehicle overlays, and shared UI.
- `convex/` - Convex schema, queries, and functions.
- `lib/` - Shared server helpers.
- `public/` - Static assets.
- `scripts/` - Maintenance scripts.
- `stops/` - Stop generation utilities and stop data.
- `JSON/` - Cached route, fleet, and station datasets.

## Main Pages

- `/` - Main app shell.
- `/profile` - User profile and account pages.
- `/log` - Trip logging and trip history.
- `/stats` - Statistics dashboard.
- `/friends` - Friend-related views.
- `/liveries` - Vehicle livery browsing.
- `/completion` - Operator and route completion views.
- `/trip/[date]/map` - Date-specific trip map.
- `/admin` - Admin page.
- `/legal` - Legal information.
- `/request-edit` - Edit request flow.

## Map and Data Flow

The live map uses MapLibre and loads its style through `/api/proxy/map-style`. Vehicle overlays are drawn from `/api/live-vehicles`, and clicking a vehicle loads route geometry through `/api/route-info`.

The departure panel fetches `/api/departures` for stop-specific train and bus departures. Those routes call external providers server-side so browser clients do not need direct access to upstream secrets.

## API Reference

Full endpoint documentation is in [docs/API.md](docs/API.md).

## Data Sources

- RealTimeTrains for rail token refresh, departure data, and route/service metadata.
- bustimes.org for bus departures, live vehicles, routes, and vehicle detail lookups.
- map-api.production.signalbox.io for route geometry and train information.
- Convex for app-owned trip, stop, operator, vehicle, livery, and statistics data.

## Notes

- Map style requests prefer the hosted style and fall back to MapTiler or a local OpenStreetMap style.
- Several API routes include rate limiting and cache layers to protect upstream providers.
- The repository includes generated JSON and stop data used by the app and scripts.