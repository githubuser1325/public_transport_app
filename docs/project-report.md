# Project description

## Purpose

Plovdiv Bus Tracker is a web application for exploring the public transport network in Plovdiv and comparing published departures with available live bus information. It is intended as a course project demonstrating the integration of open transit data, a map interface and transparent arrival estimates.

## User functions

- Browse and search the GTFS stop list and select a stop on the map or in the list.
- View upcoming published departures for the selected stop.
- View fresh bus positions from the LiveTransport WebSocket, with source age shown in map tooltips.
- Select a bus to inspect its reported line, destination, speed and live trip stop sequence when supplied upstream.
- See live stop ETAs only when the matched active trip confirms the stop is still ahead; scheduled times remain separately labeled.
- Optionally share a one-time location reading with the browser to estimate whether there is time to walk to the selected stop.

## Design and implementation

The client is a responsive Next.js/React interface. Leaflet renders the Plovdiv map and OpenStreetMap tiles. Server route handlers parse the configured GTFS ZIP and normalize live-trip responses. Small TypeScript modules isolate time calculations, feed validation, reconnect behavior, geolocation and catchability logic.

## Quality goals

The application distinguishes published schedule estimates from live reports, labels stale or unavailable feeds, avoids inventing vehicle positions and keeps location calculations local to the browser. Key calculations and feed parsing helpers have focused automated tests. Detailed checks and known limitations are in [testing and limitations](testing-and-limitations.md).
