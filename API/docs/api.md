# Timetable API Reference

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/departures/` | Upcoming departures for a station |
| `GET` | `/api/service/` | Full calling points for a specific service |

---

## `GET /api/departures/`

Returns the next departures from a station, ordered by time.

### Station (required - one of)

| Parameter | Type | Example | Notes |
|-----------|------|---------|-------|
| `crs` | string | `MAN` | CRS code of the queried station |
| `tiploc` | string | `MNCRPIC` | TIPLOC of the queried station |

### Date & Time Window

| Parameter | Type | Default | Example | Notes |
|-----------|------|---------|---------|-------|
| `date` | string `YYYY-MM-DD` | today | `2026-03-20` | Timetable date to query |
| `time` | string `HH:MM` or `HHMM` | now | `14:30` | Show services at or after this time |
| `show_zz` | boolean `1 / true / yes` | hidden | `1` | Include ZZ engineering / ECS services |

### Service Filters

| Parameter | Type | Example | Notes |
|-----------|------|---------|-------|
| `headcode` | string | `1A01` | Exact headcode match (case-insensitive) |
| `operator` | string | `Avanti` | Partial match on operator name, or exact match on operator code |
| `day` | string or integer | `Monday` or `0` | Services running on the given day. Day name or index (Monday=0 … Sunday=6) |
| `type` | `stopping` \| `passing` | `stopping` | `stopping` - has an arrival and/or departure. `passing` - pass time only, does not stop |

### Origin & Destination Filters

| Parameter | Type | Example | Notes |
|-----------|------|---------|-------|
| `origin_crs` | string | `EUS` | CRS code of the service's first stop |
| `origin_name` | string | `London` | Partial name match on the service's first stop |
| `destination_crs` | string | `GLC` | CRS code of the service's last stop |
| `destination_name` | string | `Glasgow` | Partial name match on the service's last stop |

### Example Request

```
GET /api/departures/?crs=MAN&time=14:30&operator=Avanti&destination_crs=EUS
```

### Response

```json
{
    "date": "2026-03-20",
    "time_after": 52200,
    "station": {
        "name": "Manchester Piccadilly",
        "crs": "MAN",
        "tiploc": "MNCRPIC",
        "lat": 53.4773,
        "lon": -2.2309,
        "link": "http://example.com/api/departures/?crs=MAN"
    },
    "results": [
        {
            "time": {
                "arrival":   "14:32:00",
                "departure": "14:35:00",
                "pass":      null,
                "display":   "14:32 - 14:35 | arr-dep",
                "sort_time": "14:35:00",
                "type":      "stopping"
            },
            "platform": "1",
            "origin": {
                "name": "Manchester Piccadilly",
                "crs": "MAN",
                "tiploc": "MNCRPIC",
                "lat": 53.4773,
                "lon": -2.2309,
                "link": "http://example.com/api/departures/?crs=MAN"
            },
            "destination": {
                "name": "London Euston",
                "crs": "EUS",
                "tiploc": "EUSTON",
                "lat": 51.5284,
                "lon": -0.1331,
                "link": "http://example.com/api/departures/?crs=EUS"
            },
            "cif_train_uid": "W12345",
            "headcode": "1A01",
            "operator": "Avanti West Coast",
            "schedule_days_runs": "Monday to Friday",
            "rtt_link": "https://www.realtimetrains.co.uk/service/gb-nr:W12345/2026-03-20/detailed"
        }
    ]
}
```

### `time` object

| Field | Type | Notes |
|-------|------|-------|
| `arrival` | `HH:MM:SS` \| `null` | Scheduled arrival time |
| `departure` | `HH:MM:SS` \| `null` | Scheduled departure time |
| `pass` | `HH:MM:SS` \| `null` | Pass time (non-stopping services) |
| `display` | string | Human-readable summary - see formats below |
| `sort_time` | `HH:MM:SS` | Time used for ordering: departure → arrival → pass |
| `type` | `stopping` \| `passing` | `passing` only when pass time exists with no arr/dep |

**`display` formats**

| Scenario | Format |
|----------|--------|
| Arrival + departure | `13:21 - 13:23 \| arr-dep` |
| Departure only | `13:21 \| dep` |
| Arrival only | `13:21 \| arr` |
| Pass only | `13:21 \| pass` |
| No time data | `-` |

---

## `GET /api/service/`

Returns the full ordered list of calling points for a specific service.

### Parameters (one of)

| Parameter | Type | Example | Notes |
|-----------|------|---------|-------|
| `cif_train_uid` | string | `W12345` | Unique CIF train UID - returns a single schedule |
| `headcode` | string | `1A01` | If multiple schedules match, a list of options is returned |

### Example Request

```
GET /api/service/?cif_train_uid=W12345
```

### Response

```json
{
    "timetable": "W12345",
    "headcode": "1A01",
    "schedule_days_runs": "Monday to Friday",
    "locations": [
        {
            "stop": {
                "name": "Manchester Piccadilly",
                "crs": "MAN",
                "tiploc": "MNCRPIC",
                "lat": 53.4773,
                "lon": -2.2309,
                "link": "http://example.com/api/departures/?crs=MAN"
            },
            "time": {
                "arrival":   null,
                "departure": "14:35:00",
                "pass":      null,
                "display":   "14:35 | dep",
                "sort_time": "14:35:00",
                "type":      "stopping"
            },
            "platform": "1"
        }
    ]
}
```

### Multiple Matches Response

If `headcode` matches more than one schedule, a disambiguation list is returned:

```json
{
    "detail": "more than one service found",
    "matches": [
        {
            "operator": "Avanti West Coast",
            "timetable": "W12345",
            "schedule_days_runs": "Monday to Friday",
            "link": "http://example.com/api/service/?cif_train_uid=W12345"
        }
    ]
}
```

---

## Error Responses

| Status | Scenario | `detail` message |
|--------|----------|-----------------|
| `400` | No `crs` or `tiploc` provided | `Provide crs or tiploc` |
| `400` | Invalid date format | `Invalid date format, use YYYY-MM-DD` |
| `400` | Invalid time format | `Invalid time format` |
| `400` | Invalid `type` value | `type must be 'stopping' or 'passing'` |
| `400` | No `headcode` or `cif_train_uid` | `Provide headcode or cif_train_uid` |
| `404` | Service not found | `Timetable not found` |

---

## Notes

- **`schedule_days_runs`** is returned as a human-readable string, e.g. `Daily`, `Monday to Friday`, `Saturday, Sunday`.
- **`rtt_link`** links to the Real Time Trains detailed service page for the current date.
- **ZZ services** (engineering / empty coaching stock moves) are hidden by default. Pass `show_zz=1` to include them.
- Results are capped at **10 services** per request, ordered by `sort_time` ascending.