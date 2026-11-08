# Plovdiv Bus Tracker

A local web app for browsing Plovdiv bus stops, current bus positions, and stop arrival estimates. It uses a dated Plovdiv GTFS Static ZIP from Bulgaria's National Access Point (NAP) catalog for stops and schedules and LiveTransport.eu's public Plovdiv WebSocket for vehicle positions and realtime trip delays.

Select a bus to highlight its route and inspect the full stop sequence with times adjusted by the latest reported delay. Select a stop in that route to compare approaching live buses with the published timetable.

Use **Can I catch it?** in the arrivals panel to compare a one-time location reading with live and scheduled arrivals. Location is processed in the browser and is not sent to the server.

## Requirements

- Node.js LTS and npm
- Internet access to the Plovdiv GTFS static ZIP, LiveTransport WebSocket, and map tiles

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. `.env.example` includes the verified NAP catalog download URL for its 2026-08-17 snapshot. Set `GTFS_STATIC_URL` to the latest catalog download URL when the operator publishes a new file. The ZIP's feed metadata names LiveTransport.eu as publisher. LiveTransport's catalog lists Plovdiv data as CC BY 4.0; the NAP dataset metadata itself does not state a separate license. The app attributes schedules to LiveTransport.eu.
4. Start the local server with `npm run dev`.
5. Open `http://localhost:3000` in a browser on the same PC.

The server downloads and parses the GTFS feed on demand, then caches the static timetable for ten minutes. The browser keeps a WebSocket connection to LiveTransport for bus coordinates, reported speed, direction, and delay. Vehicle positions older than five minutes are removed. For a selected stop, the app checks up to ten nearby buses on scheduled serving lines and requests their active trip details; a live ETA is shown only when the trip confirms that the selected stop is still ahead. OpenStreetMap provides map tiles.

## Checks

- `npm test` runs the GTFS time and arrival calculation tests.
- `npm run typecheck` checks the TypeScript sources.
- `npm run build` creates a production build.

## Data limitations

- Stop coordinates and published departure times come from the configured GTFS static feed.
- Bus markers use LiveTransport reported coordinates and show when the source last updated them. They are third-party reports, not a direct operator GPS guarantee.
- Live stop ETAs use the active trip's scheduled stop timestamp plus the currently reported delay; they can still change if the bus or trip data changes.
- Scheduled departures remain visible separately as a fallback.

## Catchability estimate

The walking estimate uses straight-line distance with a 25% urban detour allowance and a 4.8 km/h walking pace. A bus is marked tight when it arrives within two minutes of the estimated walk; the estimate does not include an actual pedestrian route, crossings, or individual walking speed. Scheduled buses are labeled as scheduled estimates; live buses use the current trip ETA when available.

## GTFS sources

- **Official NAP catalog:** the [Plovdiv transport data catalog](https://sipbg.gov.bg/bgnap/portal/en/catalog/1bb57544-8bb4-4f77-8d65-5d31ffdee221) lists an active GTFS Static ZIP from OP Organizatsiya i kontrol po transporta, dated August 17, 2026. The dated download URL is configured in `.env.example`; it is a pinned snapshot and must be updated when the catalog changes.
- **License:** the downloaded ZIP's `feed_info.txt` identifies `livetransport.eu` as publisher (feed dates 2026-08-13 through 2026-12-31). The NAP catalog metadata does not specify a license. LiveTransport.eu's own Plovdiv feed catalog lists CC BY 4.0 and attribution; confirm with the data provider before redistributing the NAP copy if separate terms are required.
