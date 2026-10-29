# Plovdiv Bus Tracker

A local web app for browsing Plovdiv bus stops, current bus positions, and stop arrival estimates. It uses the official Plovdiv Municipality GTFS static feed for stops/schedules and LiveTransport.eu's public Plovdiv WebSocket for vehicle positions and realtime trip delays.

Select a bus to highlight its route and inspect the full stop sequence with times adjusted by the latest reported delay. Select a stop in that route to compare approaching live buses with the published timetable.

## Requirements

- Node.js LTS and npm
- A verified public Plovdiv GTFS static ZIP URL
- Internet access for the LiveTransport WebSocket and map tiles

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `GTFS_STATIC_URL` in `.env.local` to the verified GTFS ZIP URL. The direct feed URL is not included because a reliable official URL has not yet been confirmed.
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