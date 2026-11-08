# Data sources and attribution

## Static timetable

The app uses the Plovdiv GTFS Static ZIP configured by `GTFS_STATIC_URL`. The municipal [Bulgarian NAP catalog entry](https://sipbg.gov.bg/bgnap/portal/en/catalog/1bb57544-8bb4-4f77-8d65-5d31ffdee221) identifies the public transport data publisher as OP Organizatsiya i kontrol po transporta. The LiveTransport.eu [GTFS catalog](https://gtfs.livetransport.eu/) lists the Plovdiv feed and a [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/). The app adapts stop and timetable data for display and credits both the feed and municipal catalog in its interface. The explicit CC BY 4.0 designation is attached to the LiveTransport feed; the NAP record identifies the municipal publisher but does not state a separate license.

The feed is external and can change independently of the app. Current validity and service calendars are read from the feed at runtime; no timetable is embedded in the source code.

## Vehicle positions and trip details

The browser connects to the public LiveTransport Plovdiv WebSocket by default. Live trip and selected-stop ETA details are requested through the app's server endpoints. These are third-party reports and depend on upstream availability, freshness and trip matching. A lack of live marker or ETA means no suitable current report was available; it is not evidence that no bus is operating.

## Map tiles

Map tiles are provided by OpenStreetMap. The map displays the required OpenStreetMap contributor attribution.
