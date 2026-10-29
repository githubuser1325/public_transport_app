import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { NextResponse } from "next/server";
import { getPlovdivClock, getUpcomingArrivals, type Arrival, type Stop } from "@/lib/gtfs";

export const runtime = "nodejs";

type CsvRow = Record<string, string>;
type FeedData = {
  stops: Stop[];
  schedulesByStop: Record<string, Array<{ tripId: string; route: string; headsign: string; departureTime: string }>>;
  loadedAt: string;
};

let cachedFeed: FeedData | null = null;
let cachedAt = 0;
const cacheDurationMs = 10 * 60 * 1000;
const weekdayColumns = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function readCsv(files: Record<string, Uint8Array>, name: string): CsvRow[] {
  const entry = Object.entries(files).find(([path]) => path.endsWith(`/${name}`) || path === name)?.[1];
  if (!entry) return [];
  return parse(new TextDecoder().decode(entry), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  }) as CsvRow[];
}

function getActiveServices(calendar: CsvRow[], exceptions: CsvRow[], date: string, weekday: number) {
  const active = new Set<string>();
  for (const row of calendar) {
    if (date >= row.start_date && date <= row.end_date && row[weekdayColumns[weekday]] === "1") {
      active.add(row.service_id);
    }
  }
  for (const row of exceptions) {
    if (row.date !== date) continue;
    if (row.exception_type === "1") active.add(row.service_id);
    if (row.exception_type === "2") active.delete(row.service_id);
  }
  return active;
}

async function loadFeed(): Promise<FeedData> {
  if (cachedFeed && Date.now() - cachedAt < cacheDurationMs) return cachedFeed;
  const feedUrl = process.env.GTFS_STATIC_URL;
  if (!feedUrl) throw new Error("Set GTFS_STATIC_URL to a verified public GTFS ZIP URL.");

  const response = await fetch(feedUrl, { next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`GTFS download failed (${response.status}).`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const stopRows = readCsv(files, "stops.txt");
  const tripRows = readCsv(files, "trips.txt");
  const stopTimeRows = readCsv(files, "stop_times.txt");
  const routeRows = readCsv(files, "routes.txt");
  const calendarRows = readCsv(files, "calendar.txt");
  const exceptionRows = readCsv(files, "calendar_dates.txt");

  if (!stopRows.length || !tripRows.length || !stopTimeRows.length) {
    throw new Error("The configured ZIP does not contain the required GTFS files.");
  }

  const clock = getPlovdivClock();
  const activeServices = getActiveServices(calendarRows, exceptionRows, clock.date, clock.weekday);
  const stops = stopRows
    .map((row) => ({
      id: row.stop_id,
      name: row.stop_name || row.stop_id,
      latitude: Number(row.stop_lat),
      longitude: Number(row.stop_lon),
    }))
    .filter((stop) => stop.id && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));
  const stopNames = new Map(stops.map((stop) => [stop.id, stop.name]));
  const routes = new Map(routeRows.map((row) => [row.route_id, row.route_short_name || row.route_long_name || row.route_id]));
  const trips = new Map(tripRows.map((row) => [row.trip_id, row]));
  const grouped: Record<string, Array<{ tripId: string; route: string; headsign: string; departureTime: string }>> = {};

  for (const row of stopTimeRows) {
    const trip = trips.get(row.trip_id);
    if (!trip || !activeServices.has(trip.service_id)) continue;
    const departureTime = row.departure_time || row.arrival_time;
    if (!departureTime || !stopNames.has(row.stop_id)) continue;
    (grouped[row.stop_id] ??= []).push({
      tripId: row.trip_id,
      route: routes.get(trip.route_id) || trip.route_id,
      headsign: trip.trip_headsign || "",
      departureTime,
    });
  }

  cachedFeed = { stops, schedulesByStop: grouped, loadedAt: new Date().toISOString() };
  cachedAt = Date.now();
  return cachedFeed;
}

export async function GET(request: Request) {
  try {
    const feed = await loadFeed();
    const stopId = new URL(request.url).searchParams.get("stopId");
    const clock = getPlovdivClock();
    return NextResponse.json({
      source: "GTFS static schedule",
      liveVehiclePositions: false,
      loadedAt: feed.loadedAt,
      stops: feed.stops,
      routes: stopId ? [...new Set((feed.schedulesByStop[stopId] ?? []).map((row) => row.route))] : [],
      arrivals: stopId ? getUpcomingArrivals(feed.schedulesByStop[stopId] ?? [], clock.seconds) : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the transit feed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}