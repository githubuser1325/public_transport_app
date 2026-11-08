# Architecture

## Runtime

Plovdiv Bus Tracker is a Next.js App Router application. The browser renders the map and interactive panels; server route handlers load the published GTFS archive and query live trip endpoints. Static GTFS is cached in process memory for ten minutes. The browser maintains one WebSocket connection for current vehicle reports.

## Data flow

1. `GET /api/transit` downloads the HTTPS GTFS ZIP when its in-memory cache expires, parses stops, routes, trips, calendars and stop times, then returns stops and (when a `stopId` is supplied) upcoming departures for the Plovdiv-local service date.
2. `src/lib/live-connection.ts` reconnects the browser WebSocket. `src/lib/live-transport.ts` validates bus reports, merges incremental updates and expires old positions. Only reports no older than 90 seconds are shown as live markers; records over five minutes old are discarded.
3. `GET /api/transit/live-trip` retrieves details for a selected vehicle. The client displays its stop sequence and the decoded route shape when the upstream response contains them.
4. `GET /api/transit/live-arrival` matches candidate buses to an active trip and reports an ETA only when the selected stop remains ahead and the trip supplies a usable time.
5. The catchability estimate is calculated in the browser from one-time geolocation, straight-line distance, a configurable walking pace and buffer. Coordinates are not sent to the application server.

## Main modules

- `src/app/page.tsx`: state, requests, selection and user interface.
- `src/components/TransitMap.tsx`: Leaflet map, stop markers, reported bus markers and selected trip line.
- `src/app/api/transit/`: server endpoints for static departures and live trip/arrival data.
- `src/lib/gtfs.ts`: local time, GTFS time and future-departure calculations.
- `src/lib/live-transport.ts`, `live-connection.ts`, `live-arrival.ts`: live feed validation, reconnect handling and ETA normalization.
- `src/lib/location.ts`, `catchability.ts`: browser geolocation and walk estimate.

## Configuration

`GTFS_STATIC_URL` must point to an HTTPS GTFS ZIP. `NEXT_PUBLIC_LIVE_TRANSPORT_WS` optionally overrides the default Plovdiv WebSocket endpoint. See `.env.example` and the root README for local setup.
