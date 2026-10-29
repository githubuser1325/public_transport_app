# Workspace Guidance

- This is a Next.js App Router application using TypeScript, React, Leaflet, Plovdiv GTFS static schedules, and the LiveTransport.eu public realtime WebSocket.
- Attribute vehicle positions to LiveTransport.eu and show report freshness; do not describe them as direct operator GPS guarantees.
- Keep static schedule claims distinct from live vehicle positions and delay-adjusted trip ETAs.
- Keep GTFS parsing and arrival calculations in `src/lib` or `/api/transit`; preserve the cache and Plovdiv timezone handling.
- Add or update tests in `src/lib/gtfs.test.ts` when changing timetable parsing, realtime parsing, stale-position cleanup, or ETA calculations.
- Run `npm test`, `npm run typecheck`, and `npm run build` after behavior changes.
- `GTFS_STATIC_URL` must point to a verified public feed; do not invent or hard-code a feed endpoint.
- The realtime endpoint is configured as `NEXT_PUBLIC_LIVE_TRANSPORT_WS`; keep its source attribution in the UI.
