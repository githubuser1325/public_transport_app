import assert from "node:assert/strict";
import test from "node:test";
import { getUpcomingArrivals, parseGtfsTime } from "./gtfs";
import { decodeTripShape, getLiveStopArrival, normalizeLiveTrip } from "./live-arrival";
import { mergeLiveVehicleUpdates, parseLiveTransportMessage } from "./live-transport";

test("parses GTFS times, including trips after midnight", () => {
  assert.equal(parseGtfsTime("07:05:09"), 25_509);
  assert.equal(parseGtfsTime("25:10:00"), 90_600);
  assert.equal(parseGtfsTime("07:61:00"), null);
});

test("returns only future arrivals in chronological order", () => {
  const arrivals = getUpcomingArrivals([
    { tripId: "later", route: "4", headsign: "Center", departureTime: "10:15:00" },
    { tripId: "past", route: "7", headsign: "East", departureTime: "09:59:00" },
    { tripId: "soon", route: "1", headsign: "Station", departureTime: "10:05:00" },
  ], 10 * 3600, 5);

  assert.deepEqual(arrivals.map((arrival) => arrival.tripId), ["soon", "later"]);
  assert.deepEqual(arrivals.map((arrival) => arrival.minutesAway), [5, 15]);
});

test("parses bus positions and ignores other vehicle types", () => {
  const vehicles = parseLiveTransportMessage(JSON.stringify({
    timestamp: 100_000,
    data: [
      ["3/PB0632XE", "bus", "4", "PB0632XE_7", { bg: "А13", en: "A13" }, -70_000, [42.12, 24.7], 151, 7, 99_000],
      ["tram-1", "tram", "1", "", null, 0, [42.13, 24.7], 0, 0, 99_000],
    ],
  }));

  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].lineId, "4");
  assert.equal(vehicles[0].latitude, 42.12);
  assert.equal(vehicles[0].delayMs, -70_000);
});

test("merges incremental positions and drops reports older than five minutes", () => {
  const [first, stale] = ["bus-1", "bus-2"].map((id, index) => ({
    id,
    type: "bus",
    lineId: "4",
    blockId: "",
    destination: null,
    delayMs: null,
    latitude: 42.1 + index,
    longitude: 24.7,
    bearing: null,
    speedKmh: null,
    lastUpdated: index === 0 ? 800_000 : 699_999,
  }));
  const updated = { ...first, latitude: 43.1, lastUpdated: 900_000 };

  const merged = mergeLiveVehicleUpdates([first, stale], [updated], 1_000_000);
  assert.deepEqual(merged.map((vehicle) => vehicle.id), ["bus-1"]);
  assert.equal(merged[0].latitude, 43.1);
});

test("calculates a realtime stop ETA only when the stop is still ahead", () => {
  const result = getLiveStopArrival({
    nextStop: 1,
    delay: 30_000,
    trip: { stops: [{ id: "A", scheduled: 1_060_000 }, { id: "B", scheduled: 1_180_000 }] },
  }, "B", 1_000_000);

  assert.deepEqual(result, { arrivalTime: 1_210_000, minutesAway: 4, delayMs: 30_000 });
  assert.equal(getLiveStopArrival({ nextStop: 2, delay: 0, trip: { stops: [{ id: "B", scheduled: 1_100_000 }] } }, "B", 1_000_000), null);
  assert.equal(getLiveStopArrival({ nextStop: -1, delay: 0, trip: { stops: [{ id: "B", scheduled: 1_100_000 }] } }, "B", 1_000_000), null);
});

test("decodes LiveTransport route shapes at precision five", () => {
  assert.deepEqual(decodeTripShape("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
  assert.deepEqual(decodeTripShape("invalid"), []);
});

test("normalizes trip stops with per-stop delay overriding the trip delay", () => {
  const trip = normalizeLiveTrip({
    nextStop: 0,
    delay: 120_000,
    destination: { en: "Center" },
    trip: { id: "trip-1", lineId: "4", shape: "shape", stops: [{ id: "A", scheduled: 1_000_000 }, { id: "B", scheduled: 1_060_000 }] },
    stops: [{ id: "B", delay: -60_000 }],
  });

  assert.equal(trip?.stops[0].arrivalAt, 1_120_000);
  assert.equal(trip?.stops[1].arrivalAt, 1_000_000);
  assert.equal(trip?.destination?.en, "Center");
});