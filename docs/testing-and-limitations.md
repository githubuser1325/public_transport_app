# Testing and known limitations

## Verified in this local checkout

- The local browser loaded the app, its 517-stop list and live vehicle stream. This confirms the current local UI/data path; it is not a Preview or Production check.
- The live status is driven by the WebSocket open/close state separately from position freshness. An open connection waiting for its first GPS report is not presented as a failed connection; reconnecting, no-GPS and stale-position states have distinct labels. Keyboard focus has a visible outline and status changes are announced.
- Mobile layout was checked in Playwright with Chromium viewport emulation at 390x844 and 360x800 pixels. There was no horizontal overflow; the header, search, stop list, map, arrival panel and controls remained reachable, with lower content available by normal vertical scrolling. These are browser-emulation checks, not tests on physical phones. The CSS stacks the sidebar and map/results vertically up to 650px, caps the stop list at 180px and trip details at 300px, and gives the map a 52vh height with a 300px minimum; arrival and trip rows use narrower columns, catchability settings wrap, and the top bar uses compact spacing.
- Geolocation was exercised in Playwright/Chromium using controlled test coordinates: permission allowed, permission denied, timeout, and another attempt after denial. The successful case produced a local walking estimate; the error cases kept the scheduled arrivals available and did not reuse a stale location. No real device or personal user coordinates were used.
- Live ETA source and calculation: the server requests the selected vehicle trip from LiveTransport's Plovdiv vehicle-trip API. It verifies the returned trip line against the selected vehicle line, finds the selected stop at or after the trip's `nextStop`, and calculates `scheduledAt + delayMs`. A stop-specific delay takes precedence over trip-level delay. The server rounds remaining time up to minutes and rejects cancelled trips, missing delay, a stop already passed, ETAs more than 180 minutes away, and arrivals more than five minutes overdue.
- This ETA is a schedule plus the provider's reported delay, not a prediction derived from current GPS position, speed, traffic or road geometry. It is approximate and can change; GPS positions are separately sourced from the live vehicle stream. If the trip API lacks a usable delay or trip match, the app falls back to the published schedule or reports no live ETA.
- GTFS service dates use the `Europe/Sofia` calendar date and weekday. `calendar.txt` establishes regular service and `calendar_dates.txt` adds/removes date-specific service. At early hours, the previous service date is also checked; previous-day trips with times from `24:00:00` through `47:59:59` are shifted to the corresponding current-day clock time. Previous-day ordinary daytime trips and trips at/after 48:00 are not treated as today's arrivals. This logic is recalculated on each API request while the parsed feed cache remains reusable, avoiding a service-date decision frozen at cache-load time.
- Automated tests cover Plovdiv-local date rollover, the autumn daylight-saving transition, calendar exceptions, previous-service-day overnight times, filtering out previous-day non-overnight service, and reporting an open WebSocket before GPS data arrives.

## Automated checks

- `npm test` runs Node's test runner through `tsx` for GTFS parsing/calendar and arrival times, catchability boundaries, live report validation and freshness, reconnection, trip normalization/ETA, and browser geolocation outcomes.
- `npm run typecheck` runs the TypeScript compiler without emitting files.
- `npm run build` creates the Next.js production build.
- `git diff --check` checks the working tree for whitespace errors.

## Remaining limitations

- Browser viewport emulation does not replace physical-device testing. Mobile browser chrome, operating-system permission surfaces, device-specific rendering and hardware behavior were not tested on real phones.
- Static GTFS is cached in process memory for ten minutes; each server instance has its own cache. Feed download or parsing failures prevent stop and schedule loading until a later retry.
- The static timetable is only as current and complete as its publisher's feed, calendar and exceptions. Exceptional service changes absent from the feed cannot be inferred.
- The live vehicle stream and trip details depend on the public LiveTransport service and its reporting cadence/coverage. No active vehicle can mean a connected feed with no GPS updates; that is distinct from a failed connection.
- The catchability walk time uses straight-line distance with a 25% urban detour allowance and selected average pace. It omits pedestrian routing, crossings, accessibility barriers and personal variation; the result is not a guarantee.
- OpenStreetMap tile availability and internet access are required; there is no offline map cache.
- The interface is currently English-first although source data may include Bulgarian destination text.
- No Preview or Production deployment was changed or verified as part of these local checks.
