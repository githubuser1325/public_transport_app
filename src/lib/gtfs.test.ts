import assert from "node:assert/strict";
import test from "node:test";
import { getUpcomingArrivals, parseGtfsTime } from "./gtfs";
import { assessCatchability, estimateWalkingMinutes } from "./catchability";
import { decodeTripShape, getLiveStopArrival, matchesLiveTripLine, normalizeLiveTrip } from "./live-arrival";
import { hasLiveStreamGoneStale, isLiveVehicleFresh, isLiveVehicleRecent, mergeLiveVehicleUpdates, parseLiveTransportMessage } from "./live-transport";

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

test("orders arrivals by scheduled time when their displayed minutes are equal", () => {
  const arrivals = getUpcomingArrivals([
    { tripId: "later", route: "4", headsign: "Center", departureTime: "10:05:40" },
    { tripId: "sooner", route: "7", headsign: "East", departureTime: "10:05:10" },
  ], 10 * 3600);

  assert.deepEqual(arrivals.map((arrival) => arrival.tripId), ["sooner", "later"]);
});

test("estimates walking time and whether there is time to reach a stop", () => {
  const walkingMinutes = estimateWalkingMinutes(
    { latitude: 42.1354, longitude: 24.7453 },
    { latitude: 42.1354, longitude: 24.7453 },
  );

  assert.equal(walkingMinutes, 0);
  assert.equal(estimateWalkingMinutes({ latitude: 0, longitude: 0 }, { latitude: 0.001, longitude: 0 }), 2);
  assert.equal(assessCatchability(8, 3), "comfortable");
  assert.equal(assessCatchability(5, 3), "tight");
  assert.equal(assessCatchability(2, 3), "unlikely");
  assert.equal(estimateWalkingMinutes({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }), null);
});

test("uses the selected walking pace and detour distance when estimating arrival margin", () => {
  const from = { latitude: 0, longitude: 0 };
  const to = { latitude: 0.01, longitude: 0 };
  const slowWalk = estimateWalkingMinutes(from, to, 3.2);
  const briskWalk = estimateWalkingMinutes(from, to, 6.0);

  assert.ok(slowWalk !== null && briskWalk !== null && slowWalk > briskWalk);
  assert.equal(assessCatchability(slowWalk + 5, briskWalk, 0), "comfortable");
  assert.equal(assessCatchability(slowWalk + 3, slowWalk, 2), "comfortable");
  assert.equal(assessCatchability(slowWalk + 3, slowWalk, 5), "tight");
  assert.equal(assessCatchability(slowWalk - 1, slowWalk, 5), "unlikely");
  assert.equal(estimateWalkingMinutes(from, to, 0), null);
  assert.equal(estimateWalkingMinutes(from, to, 4.8, 0.9), null);
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

test("rejects malformed and out-of-range GPS positions", () => {
  const vehicles = parseLiveTransportMessage(JSON.stringify({ data: [
    ["bad-lat", "bus", "4", "", null, 0, [91, 24.7], 0, 0, 99_000],
    ["bad-lon", "bus", "4", "", null, 0, [42.1, 181], 0, 0, 99_000],
    ["bad-row", "bus", "4", "", null, 0, [42.1], 0, 0, 99_000],
  ] }));

  assert.deepEqual(vehicles, []);
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

test("keeps the newest GPS report, rejects future clock jumps, and expires stale positions", () => {
  const vehicle = {
    id: "bus-1", type: "bus", lineId: "4", blockId: "", destination: null,
    delayMs: null, latitude: 42.1, longitude: 24.7, bearing: null, speedKmh: null, lastUpdated: 990_000,
  };
  const olderUpdate = { ...vehicle, latitude: 43, lastUpdated: 980_000 };
  const futureUpdate = { ...vehicle, latitude: 44, lastUpdated: 1_100_001 };

  assert.equal(mergeLiveVehicleUpdates([vehicle], [olderUpdate], 1_000_000)[0].latitude, 42.1);
  assert.equal(mergeLiveVehicleUpdates([vehicle], [futureUpdate], 1_000_000)[0].latitude, 42.1);
  assert.equal(isLiveVehicleFresh({ ...vehicle, lastUpdated: 700_000 }, 1_000_000), true);
  assert.equal(isLiveVehicleFresh({ ...vehicle, lastUpdated: 699_999 }, 1_000_000), false);
  assert.equal(isLiveVehicleFresh({ ...vehicle, lastUpdated: 1_060_001 }, 1_000_000), false);
  assert.equal(isLiveVehicleRecent({ ...vehicle, lastUpdated: 910_000 }, 1_000_000), true);
  assert.equal(isLiveVehicleRecent({ ...vehicle, lastUpdated: 909_999 }, 1_000_000), false);
  assert.equal(isLiveVehicleRecent({ ...vehicle, lastUpdated: 1_060_001 }, 1_000_000), false);
});

test("marks an open feed stale when it never delivers GPS or stops updating", () => {
  assert.equal(hasLiveStreamGoneStale(null, 1_000_000, 1_029_999), false);
  assert.equal(hasLiveStreamGoneStale(null, 1_000_000, 1_030_001), true);
  assert.equal(hasLiveStreamGoneStale(1_000_000, 1_089_999, 1_090_000), false);
  assert.equal(hasLiveStreamGoneStale(1_000_000, 1_090_001, 1_090_001), true);
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
  assert.equal(getLiveStopArrival({ nextStop: 0, delay: 0, trip: { stops: [{ id: "B", scheduled: 1_000_000 + 181 * 60_000 }] } }, "B", 1_000_000), null);
  assert.equal(getLiveStopArrival({ nextStop: 0, delay: 0, trip: { stops: [{ id: "B", scheduled: 1_000_000 - 5 * 60_000 - 1 }] } }, "B", 1_000_000), null);
});

test("uses a stop-specific delay instead of the trip-wide delay for its ETA", () => {
  const result = getLiveStopArrival({
    nextStop: 0,
    delay: 30_000,
    trip: { stops: [{ id: "A", scheduled: 1_060_000 }, { id: "B", scheduled: 1_180_000 }] },
    stops: [{ id: "B", delay: 90_000 }],
  }, "B", 1_000_000);

  assert.deepEqual(result, { arrivalTime: 1_270_000, minutesAway: 5, delayMs: 90_000 });
});

test("calculates stop-specific ETAs from the compact live trip payload shape", () => {
  const result = getLiveStopArrival({
    nextStop: 0,
    delay: 30_000,
    trip: ["trip-id", null, "4", "", { en: "Center" }, [["A", 1_060_000], ["B", 1_180_000]]],
    stops: [["B", 90_000]],
  }, "B", 1_000_000);

  assert.deepEqual(result, { arrivalTime: 1_270_000, minutesAway: 5, delayMs: 90_000 });
  assert.equal(getLiveStopArrival({ nextStop: 0, trip: ["trip-id", null, "4", "", null, [["B", 1_100_000]]] }, "B", 1_000_000), null);
  assert.equal(getLiveStopArrival({ trip: ["trip-id", null, "4", "", null, [["B", 1_100_000]]] }, "B", 1_000_000), null);
});

test("matches the next occurrence of a repeated stop and rejects stops already passed", () => {
  const trip = {
    nextStop: 2,
    delay: 60_000,
    trip: { stops: [["A", 1_010_000], ["B", 1_020_000], ["C", 1_030_000], ["A", 1_040_000]] },
  };

  assert.equal(getLiveStopArrival(trip, "A", 1_000_000)?.arrivalTime, 1_100_000);
  assert.equal(getLiveStopArrival(trip, "B", 1_000_000), null);
  assert.equal(getLiveStopArrival(trip, "missing", 1_000_000), null);
});

test("requires the active trip line to match the live bus route", () => {
  assert.equal(matchesLiveTripLine(" 4 ", "4"), true);
  assert.equal(matchesLiveTripLine("14", "4"), false);
  assert.equal(matchesLiveTripLine(undefined, "4"), false);
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
