# API Reference

This project exposes a mix of browser-facing routes and externally protected routes.

Same-origin browser requests are allowed without an API key. External callers must present a Clerk API key token using `Authorization: Bearer <key>`.

## Authentication

Shared API protection lives in [lib/api-key-auth.ts](../lib/api-key-auth.ts).

- Same-origin browser requests are allowed without an API key.
- Cross-origin requests must include a valid Clerk API key token.
- Unauthorized responses return `401`.

## Public Health Checks

### `GET /health`

Simple app health check.

Response:

```json
"OK"
```

### `GET /api/departures/health`

Checks the departures route by calling it in-process.

Query parameters:

- `code` - Stop code. Defaults to `SOT`.
- `type` - `train` or `bus`. Defaults to `train`.

Response shape:

```json
{
  "status": "ok",
  "ok": true,
  "responseTimeMs": 12,
  "hasData": true,
  "departureCount": 8,
  "timestamp": "2026-05-23T00:00:00.000Z"
}
```

### `GET /api/proxy/map-style/health`

Checks that the map style proxy returns a valid style document.

Response shape:

```json
{
  "status": "ok",
  "ok": true,
  "responseTimeMs": 8,
  "hasSources": true,
  "layerCount": 3,
  "timestamp": "2026-05-23T00:00:00.000Z"
}
```

## Core App APIs

### `GET /api/departures`

Returns train or bus departures for a stop.

Query parameters:

- `code` - Stop or location code.
- `type` - `train` or `bus`.
- `date` - Optional date in `YYYY-MM-DD`.
- `time` - Optional time in `HH:mm`.
- `datetime` - Optional ISO datetime.
- `pass` - Set to `show` to include passing services.
- `debug` - Set to `true` for raw upstream data.
- `limit` - Maximum departures returned. Defaults to `15`.

Train response:

```json
{
  "metadata": {
    "contains_cancelled_services": false,
    "contains_expected_times": true,
    "contains_platform_numbers": true,
    "contains_delays": true
  },
  "attributions": [],
  "departures": []
}
```

Bus response:

```json
{
  "metadata": {
    "line_names": [],
    "common_name": null,
    "name": null,
    "long_name": null
  },
  "attributions": [],
  "departures": []
}
```

Common statuses:

- `400` for missing or invalid parameters.
- `429` when rate limited.
- `481` when the requested train date is outside permitted history.

### `GET /api/live-vehicles`

Returns visible train and bus vehicles for the current bounding box.

Query parameters:

- `xmin`
- `ymin`
- `xmax`
- `ymax`
- `showTrains` - `true` or `false`. Defaults to `true`.
- `showBuses` - `true` or `false`. Defaults to `true`.
- `debug` - Set to `true` for raw upstream payloads.

Response shape:

```json
{
  "trains": [],
  "buses": []
}
```

Train items include:

- `id`
- `delay`
- `location`
- `rotation`
- `operator`
- `service`
- `destination`
- `colour`
- `popup_data`

Bus items include:

- `id`
- `location`
- `rotation`
- `service`
- `destination`
- `colour`
- `liveryID`
- `popup_data`

Common statuses:

- `400` for missing bounds.
- `429` when rate limited.

### `GET /api/route-info`

Returns route geometry for a train or bus vehicle.

Query parameters:

- `rid` - Train RID.
- `trip_id` - Bus trip ID.

Response shape for trains:

```json
{
  "type": "train",
  "id": "123456",
  "service": "2O28",
  "operator": "West Midlands Trains",
  "destination": "Bromsgrove",
  "path": [],
  "snapped": true
}
```

Response shape for buses:

```json
{
  "type": "bus",
  "id": "577974496",
  "path": [],
  "snapped": false
}
```

Common statuses:

- `400` when both identifiers are missing.
- `429` when rate limited.

### `GET /api/routes`

Returns active, historical, and ridden routes for an operator.

Query parameters:

- `code` - Operator code or alias.
- `operator` - Alternate operator key.

Response shape:

```json
[
  {
    "service_number": "19",
    "route_name": "...",
    "withdrawn": false,
    "ridden": true,
    "times_ridden": 4
  }
]
```

### `GET /api/vehicles`

Returns vehicle summaries for an operator, combining Bustimes data with user trip history and Convex vehicle data.

Query parameters:

- `code` - Operator code.

Response shape:

```json
[
  {
    "unit_number": "1234",
    "reg": "AB12CDE",
    "vehicle_type": "Bus",
    "ridden": true,
    "times_ridden": 7
  }
]
```

### `GET /api/search`

Searches train units, bus vehicles, or both.

Query parameters:

- `q` - Search term.
- `type` - `train`, `bus`, or omitted for both.

Response shape:

```json
[
  {
    "id": "...",
    "source": "train",
    "unit_number": "...",
    "unit_reg": "...",
    "type": {
      "type_id": "...",
      "type_name": "..."
    }
  }
]
```

### `GET /api/operators`

Returns operator metadata.

Modes:

- User mode is the default and returns operators associated with the signed-in user.
- `all=1` returns all operators.

Query parameters:

- `all` - Set to `1` for full operator list.

Response shape:

```json
{
  "mode": "user",
  "total": 12,
  "operators": []
}
```

### `GET /api/log`

Returns full trip and service details for train and bus logs.

Useful query parameters:

- `service_rid` - Resolve a train service directly from RID.
- `service_uid` - Train UID.
- `service_id` - Bus trip identifier.
- `trip_id` - Bus trip identifier.
- `date` - Service date in `YYYY-MM-DD`.
- `service_date` - Alternate date parameter.
- `type` - `train` or `bus`.
- `debug` - Set to `true` for upstream payloads.
- `show_pass` - Set to `true` to include passing points for trains.

Train response includes:

- service metadata
- origin and destination details
- the full route geometry
- the merged stop list
- optional debug payload

Bus response includes:

- service metadata
- origin and destination details
- the full route geometry
- the merged stop list
- optional bus and vehicle debug payloads

## External Upstream Services

The API routes call these providers server-side:

- RealTimeTrains
- bustimes.org
- map-api.production.signalbox.io

These upstream calls are not intended to be called directly from the browser.

## Notes for External Apps

If you are integrating from outside the hosted app, call the protected routes with a Clerk API key token. If you are inside the hosted app itself, the same-origin request path is preferred and no API key is needed.