"use client";

import dynamic from "next/dynamic";
import { ArrowDownUp, Clock3, LocateFixed, MapPin, Radio, Route, Search, Signal, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Arrival, Stop } from "@/lib/gtfs";
import { assessCatchability, estimateWalkingMinutes, type Coordinates } from "@/lib/catchability";
import { decodeTripShape, type LiveTripDetails } from "@/lib/live-arrival";
import { startLiveConnection } from "@/lib/live-connection";
import { readCurrentLocation } from "@/lib/location";
import { getVisibleLiveVehicles, hasLiveStreamGoneStale, isLiveVehicleFresh, isLiveVehicleRecent, mergeLiveVehicleUpdates, parseLiveTransportMessage, type LiveVehicle } from "@/lib/live-transport";

const TransitMap = dynamic(() => import("@/components/TransitMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading Plovdiv map...</div>,
});

type TransitResponse = {
  source?: string;
  liveVehiclePositions?: boolean;
  loadedAt?: string;
  stops: Stop[];
  arrivals: Arrival[];
  routes?: string[];
  error?: string;
};

type LiveArrival = {
  vehicle: LiveVehicle;
  arrivalTime: number;
  minutesAway: number;
  delayMs: number;
};

type LiveTripResponse = { available?: boolean; trip?: LiveTripDetails | null };

function getCatchability(minutesUntilBus: number, walkingMinutes: number, bufferMinutes: number) {
  const status = assessCatchability(minutesUntilBus, walkingMinutes, bufferMinutes);
  if (!status) return null;
  const timing = status === "comfortable" ? "enough time" : status === "tight" ? "tight" : "too late";
  return { status, text: `Walk ${walkingMinutes} min · ${timing}` };
}

function delayDescription(delayMs: number | null, cancelled = false) {
  if (cancelled) return "Cancelled";
  if (delayMs === null) return "No live timing";
  const minutes = Math.floor(Math.abs(delayMs) / 60_000);
  if (minutes === 0) return "On time";
  return `${minutes} min ${delayMs > 0 ? "late" : "early"}`;
}

function formatPlovdivTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function Home() {
  const [feed, setFeed] = useState<TransitResponse | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "reconnecting" | "stale">("connecting");
  const [streamInitialized, setStreamInitialized] = useState(false);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<LiveTripDetails | null>(null);
  const [tripLoading, setTripLoading] = useState(false);
  const [tripError, setTripError] = useState("");
  const [liveArrivals, setLiveArrivals] = useState<LiveArrival[]>([]);
  const [liveArrivalLoading, setLiveArrivalLoading] = useState(false);
  const [liveArrivalError, setLiveArrivalError] = useState("");
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [walkingSpeedKmh, setWalkingSpeedKmh] = useState(4.8);
  const [bufferMinutes, setBufferMinutes] = useState(2);
  const liveVehiclesRef = useRef<LiveVehicle[]>([]);
  const lastPositionUpdateRef = useRef<number | null>(null);
  const feedRequestControllerRef = useRef<AbortController | null>(null);
  liveVehiclesRef.current = vehicles;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId && isLiveVehicleRecent(vehicle)) ?? null;
  const stopsById = useMemo(() => new Map((feed?.stops ?? []).map((stop) => [stop.id, stop])), [feed?.stops]);
  const tripStopKey = selectedTrip?.stops.map((stop) => stop.id).join(",") ?? "";
  const selectedTripShape = useMemo(() => {
    const shape = decodeTripShape(selectedTrip?.shape ?? "");
    if (shape.length > 1 || !selectedTrip) return shape;
    return selectedTrip.stops.flatMap((tripStop) => {
      const stop = stopsById.get(tripStop.id);
      return stop ? [[stop.latitude, stop.longitude] as [number, number]] : [];
    });
  }, [selectedTrip?.shape, tripStopKey, stopsById]);

  async function refresh(stopId?: string) {
    feedRequestControllerRef.current?.abort();
    const controller = new AbortController();
    feedRequestControllerRef.current = controller;
    setLoading(true);
    try {
      const query = stopId ? `?stopId=${encodeURIComponent(stopId)}` : "";
      const response = await fetch(`/api/transit${query}`, { cache: "no-store", signal: controller.signal });
      const data = (await response.json()) as TransitResponse;
      if (!response.ok) throw new Error(data.error || "Transit schedule is temporarily unavailable.");
      if (controller.signal.aborted) return;
      setFeed(data);
      if (data.stops?.length && !selectedStop) setSelectedStop(data.stops[0]);
    } catch {
      if (!controller.signal.aborted) setFeed((current) => ({
        stops: current?.stops ?? [],
        arrivals: [],
        routes: [],
        loadedAt: current?.loadedAt,
        error: "Could not load the transit schedule. Live vehicle positions may still be available.",
      }));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(selectedStop?.id), 60_000);
    return () => {
      window.clearInterval(timer);
      feedRequestControllerRef.current?.abort();
    };
  }, [selectedStop?.id]);

  useEffect(() => {
    let connectionStartedAt = Date.now();
    const socketUrl = process.env.NEXT_PUBLIC_LIVE_TRANSPORT_WS || "wss://api.livetransport.eu/plovdiv";
    const stopConnection = startLiveConnection({
      url: socketUrl,
      createSocket: (url) => new WebSocket(url),
      onStatus: (status) => {
        if (status === "connecting") connectionStartedAt = Date.now();
        setStreamState(status);
      },
      onMessage: (payload) => {
        const updates = parseLiveTransportMessage(payload);
        const now = Date.now();
        const freshUpdates = updates.filter((vehicle) => isLiveVehicleFresh(vehicle, now));
        setVehicles((current) => mergeLiveVehicleUpdates(current, freshUpdates, now));
        if (!freshUpdates.some((vehicle) => isLiveVehicleRecent(vehicle, now))) return;
        lastPositionUpdateRef.current = now;
        setStreamState("connected");
        setReceivedAt(now);
        setStreamInitialized(true);
      },
    });
    const pruneTimer = window.setInterval(() => {
      const now = Date.now();
      setVehicles((current) => mergeLiveVehicleUpdates(current, [], now));
      const lastPositionUpdate = lastPositionUpdateRef.current;
      if (hasLiveStreamGoneStale(lastPositionUpdate, connectionStartedAt, now)) {
        setStreamState((state) => state === "reconnecting" ? state : "stale");
      }
    }, 15_000);

    return () => {
      stopConnection();
      window.clearInterval(pruneTimer);
    };
  }, []);

  useEffect(() => {
    if (selectedVehicleId && !vehicles.some((vehicle) => vehicle.id === selectedVehicleId && isLiveVehicleRecent(vehicle))) {
      setSelectedVehicleId(null);
    }
  }, [selectedVehicleId, vehicles]);

  useEffect(() => {
    if (!selectedVehicleId) {
      setSelectedTrip(null);
      setTripLoading(false);
      setTripError("");
      return;
    }

    let active = true;
    let isFirstRequest = true;
    const controller = new AbortController();
    const refreshTrip = async () => {
      if (isFirstRequest) setTripLoading(true);
      try {
        const expectedLineId = vehicles.find((vehicle) => vehicle.id === selectedVehicleId)?.lineId;
        if (!expectedLineId) {
          if (active) setSelectedTrip(null);
          return;
        }
        const query = new URLSearchParams({ vehicleId: selectedVehicleId, lineId: expectedLineId });
        const response = await fetch(`/api/transit/live-trip?${query}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as LiveTripResponse;
        if (active) {
          setSelectedTrip(response.ok && result.available ? result.trip ?? null : null);
          setTripError(response.ok ? "" : "Live trip details are temporarily unavailable.");
        }
      } catch {
        if (active) {
          setSelectedTrip(null);
          setTripError("Live trip details are temporarily unavailable.");
        }
      } finally {
        if (active) {
          setTripLoading(false);
          isFirstRequest = false;
        }
      }
    };

    void refreshTrip();
    const timer = window.setInterval(() => void refreshTrip(), 30_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [selectedVehicleId]);

  useEffect(() => {
    if (!selectedStop || !streamInitialized) {
      setLiveArrivals([]);
      setLiveArrivalLoading(false);
      setLiveArrivalError("");
      return;
    }

    let active = true;
    let requestController: AbortController | null = null;
    setLiveArrivals([]);
    setLiveArrivalError("");
    const refreshLiveArrivals = async () => {
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      const isCurrentRequest = () => active && requestController === controller && !controller.signal.aborted;
      const stop = selectedStop;
      const lineIds = new Set(feed?.routes ?? []);
      const byLine = new Map<string, LiveVehicle[]>();
      const now = Date.now();
      for (const vehicle of liveVehiclesRef.current) {
        if (!lineIds.has(vehicle.lineId) || !isLiveVehicleRecent(vehicle, now)) continue;
        const candidates = byLine.get(vehicle.lineId) ?? [];
        candidates.push(vehicle);
        byLine.set(vehicle.lineId, candidates);
      }

      const distance = (vehicle: LiveVehicle) => {
        const lat = (vehicle.latitude - stop.latitude) * 111_000;
        const lon = (vehicle.longitude - stop.longitude) * 82_000;
        return Math.hypot(lat, lon);
      };
      const nearbyCandidates = [...byLine.values()]
        .flatMap((lineVehicles) => lineVehicles.sort((left, right) => distance(left) - distance(right)).slice(0, 2))
        .slice(0, 10);
      const followedVehicle = liveVehiclesRef.current.find((vehicle) => vehicle.id === selectedVehicleId && lineIds.has(vehicle.lineId));
      const candidates = [...new Map([...(followedVehicle ? [followedVehicle] : []), ...nearbyCandidates].map((vehicle) => [vehicle.id, vehicle])).values()].slice(0, 10);

      if (!candidates.length) {
        if (isCurrentRequest()) {
          setLiveArrivals([]);
          setLiveArrivalError("");
          setLiveArrivalLoading(false);
        }
        return;
      }

      setLiveArrivalLoading(true);
      const results = await Promise.all(candidates.map(async (vehicle) => {
        const query = new URLSearchParams({ vehicleId: vehicle.id, lineId: vehicle.lineId, stopId: stop.id });
        try {
          const response = await fetch(`/api/transit/live-arrival?${query}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) return { arrival: null, failed: true };
          const result = await response.json() as { available?: boolean; arrivalTime?: number; minutesAway?: number; delayMs?: number };
          if (!result.available || result.arrivalTime === undefined || result.minutesAway === undefined || result.delayMs === undefined) {
            return { arrival: null, failed: false };
          }
          return { arrival: { vehicle, arrivalTime: result.arrivalTime, minutesAway: result.minutesAway, delayMs: result.delayMs }, failed: false };
        } catch {
          return { arrival: null, failed: !controller.signal.aborted };
        }
      }));

      if (isCurrentRequest()) {
        const arrivals = results.flatMap((result) => result.arrival ? [result.arrival] : [])
          .sort((left, right) => left.arrivalTime - right.arrivalTime);
        setLiveArrivals(arrivals);
        setLiveArrivalError(!arrivals.length && results.some((result) => result.failed)
          ? "Live ETA data is temporarily unavailable. Check the scheduled times below."
          : "");
        setLiveArrivalLoading(false);
      }
    };

    void refreshLiveArrivals();
    const timer = window.setInterval(() => void refreshLiveArrivals(), 30_000);
    return () => {
      active = false;
      requestController?.abort();
      window.clearInterval(timer);
    };
  }, [feed?.routes, selectedStop, selectedVehicleId, streamInitialized]);

  const filteredStops = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return (feed?.stops ?? []).filter((stop) => stop.name.toLocaleLowerCase().includes(normalized));
  }, [feed?.stops, search]);
  const walkingMinutesToStop = userLocation && selectedStop
    ? estimateWalkingMinutes(userLocation, selectedStop, walkingSpeedKmh)
    : null;

  async function chooseStop(stop: Stop) {
    if (stop.id === selectedStop?.id) {
      await refresh(stop.id);
      return;
    }
    setSelectedStop(stop);
  }

  function requestLocation() {
    setLocationMessage("Checking your location…");
    readCurrentLocation(navigator.geolocation, (result) => {
      if (result.status === "success") {
        setUserLocation(result.coordinates);
        setLocationMessage("Location stays on this device; walk time is approximate.");
      } else {
        setLocationMessage(result.message);
      }
    });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Plovdiv Bus Tracker home">
          <span className="brand-mark"><span /></span>
          <span>plovdiv<span className="brand-light">/bus</span></span>
        </a>
        <div className={`topbar-status ${streamState}`}><span className="status-dot" /> {streamState === "connected" ? `${getVisibleLiveVehicles(vehicles).length} LIVE BUSES` : streamState === "stale" ? "GPS POSITIONS STALE" : streamState === "reconnecting" ? "LIVE FEED RECONNECTING" : "LIVE FEED CONNECTING"}</div>
        <button className="icon-button" type="button" title="Refresh arrivals" onClick={() => void refresh(selectedStop?.id)}>
          <ArrowDownUp size={17} />
        </button>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="intro">
            <p className="eyebrow">PLOVDIV, BULGARIA <span>·</span> {new Date().toLocaleDateString("en-GB")}</p>
            <h1>Make the<br /><em>next bus.</em></h1>
            <p className="subhead">Track live buses, compare arrivals, and follow each route stop by stop.</p>
          </div>

          <div className="data-note">
            <TriangleAlert size={16} />
            <div><strong>Live positions + scheduled service</strong><span>Bus coordinates come from LiveTransport; departures use the published timetable unless a live trip is matched.</span></div>
          </div>

          <div className="stop-section">
            <div className="section-heading"><span>Choose a stop</span><span className="stop-count">{feed?.stops?.length ?? "--"}</span></div>
            <label className="search-box">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stops" />
              <kbd>/</kbd>
            </label>
            <div className="stop-list">
              {filteredStops.slice(0, 250).map((stop) => (
                <button key={stop.id} className={`stop-row ${selectedStop?.id === stop.id ? "selected" : ""}`} onClick={() => void chooseStop(stop)}>
                  <MapPin size={15} />
                  <span>{stop.name}</span>
                  {selectedStop?.id === stop.id && <span className="row-arrow">↗</span>}
                </button>
              ))}
              {!loading && !feed?.stops?.length && (
                <div className="empty-stops">
                  <Signal size={20} />
                  <strong>Transit feed not connected</strong>
                  <span>{feed?.error ?? "Configure a verified GTFS ZIP URL to load Plovdiv stops."}</span>
                </div>
              )}
              {filteredStops.length > 250 && <p className="list-limit">Showing 250 matches. Refine your search.</p>}
            </div>
          </div>
          <div className="sidebar-foot"><span>SCHEDULE</span><strong>GTFS</strong><span className="foot-divider" /> <span>POSITIONS</span><strong>LIVE</strong></div>
        </aside>

        <section className="main-panel">
          <div className="map-heading">
            <div><p className="eyebrow">NETWORK VIEW</p><h2>{selectedStop?.name ?? "Plovdiv stops"}</h2></div>
            <button className="locate-button" type="button" title="Center on selected stop" onClick={() => selectedStop && void chooseStop(selectedStop)}><LocateFixed size={16} /> <span>Selected stop</span></button>
          </div>
          <div className="map-wrap">
            <TransitMap
              stops={feed?.stops ?? []}
              vehicles={getVisibleLiveVehicles(vehicles)}
              routeShape={selectedTripShape}
              selectedStopId={selectedStop?.id ?? null}
              selectedVehicleId={selectedVehicleId}
              onSelect={(stop) => void chooseStop(stop)}
              onSelectVehicle={(vehicle) => setSelectedVehicleId(vehicle.id)}
            />
            <div className="map-legend"><span className="legend-dot stop-legend" /> Stops <span className="legend-separator" /><span className="legend-dot bus-legend" /> Buses <span className="legend-separator" /><span className="legend-ring" /> Selected</div>
            <div className="map-corner">42°08&apos;N&nbsp; 24°45&apos;E</div>
          </div>

          {selectedVehicle && (
            <div className="vehicle-detail">
              <span className="vehicle-detail-route">LINE {selectedVehicle.lineId}</span>
              <strong>{selectedVehicle.destination?.en || selectedVehicle.destination?.bg || "Direction unavailable"}</strong>
              <span>Bus {selectedVehicle.id.split("/").at(-1)}</span>
              <span>{selectedVehicle.speedKmh === null ? "Speed unavailable" : `${selectedVehicle.speedKmh} km/h`}</span>
              <span>{Math.max(0, Math.floor((Date.now() - selectedVehicle.lastUpdated) / 1000))} sec old</span>
              {liveArrivals.find((arrival) => arrival.vehicle.id === selectedVehicle.id) && (
                <span className="vehicle-stop-eta">At this stop in {liveArrivals.find((arrival) => arrival.vehicle.id === selectedVehicle.id)?.minutesAway} min</span>
              )}
              <button className="clear-vehicle" type="button" title="Clear selected bus" onClick={() => setSelectedVehicleId(null)}><X size={15} /></button>
            </div>
          )}

          {selectedVehicleId && (
            <section className="trip-detail" aria-label="Selected bus route">
              <div className="trip-detail-heading">
                <div className="trip-title">
                  <Route size={17} />
                  <div><p className="eyebrow">LINE {selectedTrip?.lineId || selectedVehicle?.lineId || ""} · ALL STOPS</p><h3>{selectedTrip?.destination?.en || selectedTrip?.destination?.bg || selectedVehicle?.destination?.en || selectedVehicle?.destination?.bg || "Bus route"}</h3></div>
                </div>
                {selectedTrip && <span className={`trip-delay ${selectedTrip.cancelled ? "cancelled" : selectedTrip.delayMs !== null && selectedTrip.delayMs > 60_000 ? "late" : selectedTrip.delayMs !== null && selectedTrip.delayMs < -60_000 ? "early" : "ontime"}`}>{delayDescription(selectedTrip.stops[selectedTrip.nextStop]?.delayMs ?? selectedTrip.delayMs, selectedTrip.cancelled)}</span>}
              </div>
              {tripLoading && !selectedTrip ? (
                <div className="arrival-empty trip-empty">Loading bus stops...</div>
              ) : !selectedTrip ? (
                <div className="arrival-empty trip-empty">{tripError || (streamState !== "connected" ? "Waiting for the live trip feed..." : "Live trip details are unavailable for this bus.")}</div>
              ) : (
                <div className="trip-stop-list">
                  {selectedTrip.stops.map((tripStop, index) => {
                    const stop = stopsById.get(tripStop.id);
                    const tripFinished = selectedTrip.nextStop < 0 || selectedTrip.nextStop >= selectedTrip.stops.length;
                    const phase = selectedTrip.cancelled ? "cancelled" : tripFinished || index < selectedTrip.nextStop ? "passed" : index === selectedTrip.nextStop ? "next" : "upcoming";
                    return (
                      <button
                        key={`${tripStop.id}-${index}`}
                        className={`trip-stop-row ${phase}`}
                        type="button"
                        disabled={!stop}
                        aria-current={phase === "next" ? "step" : undefined}
                        onClick={() => stop && void chooseStop(stop)}
                      >
                        <span className="trip-stop-marker"><span /></span>
                        <span className="trip-stop-name"><strong>{stop?.name ?? `Stop ${tripStop.id}`}</strong><small>Stop ID {tripStop.id}</small></span>
                        <span className="trip-stop-time">{formatPlovdivTime(tripStop.arrivalAt)}</span>
                        <span className={`trip-stop-punctuality ${tripStop.delayMs === null ? "unknown" : tripStop.delayMs > 60_000 ? "late" : tripStop.delayMs < -60_000 ? "early" : "ontime"}`}>{selectedTrip.cancelled ? "Cancelled" : delayDescription(tripStop.delayMs)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="arrivals">
            <div className="arrivals-heading">
              <div><p className="eyebrow">SELECTED STOP</p><h3>Arrivals</h3></div>
              <div className="arrival-tools">
                <div className="arrival-meta"><Radio size={15} /><span>{receivedAt ? `Live update ${new Date(receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Connecting live feed"}</span></div>
                {selectedStop && <button className="location-check" type="button" onClick={requestLocation}>
                  <LocateFixed size={14} /> {userLocation ? "Update location" : "Can I catch it?"}
                </button>}
              </div>
            </div>
            {locationMessage && <p className="location-message" role="status">{locationMessage}{walkingMinutesToStop !== null && <> · Walk to this stop: {walkingMinutesToStop} min</>}</p>}
            {userLocation && <div className="catch-settings" aria-label="Catchability estimate settings">
              <label>Walking pace<select value={walkingSpeedKmh} onChange={(event) => setWalkingSpeedKmh(Number(event.target.value))}>
                <option value={3.2}>Slow · 3.2 km/h</option><option value={4.8}>Average · 4.8 km/h</option><option value={6}>Brisk · 6 km/h</option>
              </select></label>
              <label>Arrival buffer<select value={bufferMinutes} onChange={(event) => setBufferMinutes(Number(event.target.value))}>
                <option value={0}>None</option><option value={2}>2 min</option><option value={5}>5 min</option>
              </select></label>
            </div>}
            {selectedStop ? (
              <>
                <div className="live-arrival-section">
                  <div className="subsection-heading"><span>LIVE BUS ETAS</span><span>{liveArrivals.length || "--"}</span></div>
                  {liveArrivals.length ? liveArrivals.slice(0, 5).map((arrival) => {
                    const catchability = walkingMinutesToStop === null ? null : getCatchability(arrival.minutesAway, walkingMinutesToStop, bufferMinutes);
                    return (
                      <button className="live-arrival-row" key={arrival.vehicle.id} onClick={() => setSelectedVehicleId(arrival.vehicle.id)}>
                        <span className="route-badge live-badge">{arrival.vehicle.lineId}</span>
                        <span className="arrival-destination">{arrival.vehicle.destination?.en || arrival.vehicle.destination?.bg || "Direction unavailable"}<small>Bus {arrival.vehicle.id.split("/").at(-1)}</small>{catchability && <small className={`catchability ${catchability.status}`}>{catchability.text}</small>}</span>
                        <span className="arrival-time">{arrival.minutesAway === 0 ? "Due" : `${arrival.minutesAway} min`}</span>
                        <span className="delay-label">{arrival.delayMs === 0 ? "On time" : `${Math.max(1, Math.round(Math.abs(arrival.delayMs) / 60_000))} min ${arrival.delayMs > 0 ? "late" : "early"}`}</span>
                      </button>
                    );
                  }) : (
                    <div className="arrival-empty compact-empty">{liveArrivalLoading ? "Matching live buses to this stop..." : liveArrivalError || (streamState === "reconnecting" ? "Live feed interrupted. Showing the published schedule below." : streamState === "stale" ? "GPS positions are stale. Waiting for fresh bus locations." : streamState !== "connected" ? "Waiting for live bus positions..." : "No currently tracked bus has this stop ahead on its trip.")}</div>
                  )}
                </div>
                <div className="schedule-section">
                  <div className="subsection-heading"><span>PUBLISHED SCHEDULE</span><span>{feed?.loadedAt ? new Date(feed.loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
                  {feed?.arrivals?.length ? (
                    <div className="arrival-table">
                      {feed.arrivals.slice(0, 6).map((arrival) => {
                        const catchability = walkingMinutesToStop === null ? null : getCatchability(arrival.minutesAway, walkingMinutesToStop, bufferMinutes);
                        return (
                          <div className="arrival-row" key={`${arrival.tripId}-${arrival.departureTime}`}>
                            <span className="route-badge">{arrival.route}</span>
                            <span className="arrival-destination">{arrival.headsign || "Direction not listed"}{catchability && <small className={`catchability ${catchability.status}`}>{catchability.text} · scheduled</small>}</span>
                            <span className="arrival-time">{arrival.minutesAway === 0 ? "Due" : `${arrival.minutesAway} min`}</span>
                            <span className="scheduled-time">{arrival.departureTime.slice(0, 5)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="arrival-empty">{loading ? "Checking the timetable..." : feed?.error ?? "No upcoming departures found for this stop today."}</div>
                  )}
                </div>
              </>
            ) : (
              <div className="arrival-empty">Connect a verified GTFS feed to see stops and departures.</div>
            )}
            <p className="arrival-disclaimer">Live ETAs use the active vehicle trip and reported delay; they can still change with traffic or service updates. Scheduled times are shown separately.</p>
            <div className="source-credit">Schedules by <a href="https://gtfs.livetransport.eu/" target="_blank" rel="noreferrer">LiveTransport.eu (CC BY 4.0)</a> · Municipal catalog: <a href="https://sipbg.gov.bg/bgnap/portal/en/catalog/1bb57544-8bb4-4f77-8d65-5d31ffdee221" target="_blank" rel="noreferrer">OP OKT via Bulgarian NAP</a> · Live positions by <a href="https://livetransport.eu/#/plovdiv" target="_blank" rel="noreferrer">LiveTransport.eu</a> · Received {receivedAt ? `${Math.max(0, Math.floor((Date.now() - receivedAt) / 1000))} sec ago` : "not yet"}</div>
          </section>
        </section>
      </section>
    </main>
  );
}
