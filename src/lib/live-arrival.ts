export interface LiveStopArrival {
  arrivalTime: number;
  minutesAway: number;
  delayMs: number;
}

export const maxLiveEtaMinutes = 180;
const maxLiveEtaLatenessMs = 5 * 60_000;

export function matchesLiveTripLine(tripLineId: string | null | undefined, expectedLineId: string): boolean {
  return typeof tripLineId === "string" && tripLineId.trim() === expectedLineId.trim();
}

export function getLiveStopArrival(
  tripData: unknown,
  stopId: string,
  now = Date.now(),
): LiveStopArrival | null {
  if (!tripData || typeof tripData !== "object") return null;
  const data = tripData as {
    nextStop?: unknown;
    delay?: unknown;
  };
  const nextStop = data.nextStop;
  if (!Number.isInteger(nextStop) || Number(nextStop) < 0 || data.delay === "cancelled") return null;

  const trip = normalizeLiveTrip(tripData);
  if (!trip || Number(nextStop) >= trip.stops.length || trip.cancelled) return null;
  const targetIndex = trip.stops.findIndex((stop, index) => index >= Number(nextStop) && stop.id === stopId);
  if (targetIndex < 0) return null;
  const target = trip.stops[targetIndex];
  if (target.delayMs === null) return null;

  const arrivalTime = target.scheduledAt + target.delayMs;
  if (arrivalTime - now > maxLiveEtaMinutes * 60_000 || arrivalTime < now - maxLiveEtaLatenessMs) return null;
  return {
    arrivalTime,
    minutesAway: Math.max(0, Math.ceil((arrivalTime - now) / 60_000)),
    delayMs: target.delayMs,
  };
}

export function decodeTripShape(encoded: string): Array<[number, number]> {
  if (!encoded || encoded.length > 200_000) return [];

  const coordinates: Array<[number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const readDelta = () => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length || shift > 30) return null;
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const latitudeDelta = readDelta();
    const longitudeDelta = readDelta();
    if (latitudeDelta === null || longitudeDelta === null) return [];
    latitude += latitudeDelta;
    longitude += longitudeDelta;
    coordinates.push([latitude / 100_000, longitude / 100_000]);
  }

  return coordinates;
}

export interface LiveTripStop {
  id: string;
  scheduledAt: number;
  arrivalAt: number;
  delayMs: number | null;
}

export interface LiveTripDetails {
  id: string;
  lineId: string;
  destination: { bg?: string; en?: string } | null;
  shape: string;
  nextStop: number;
  delayMs: number | null;
  cancelled: boolean;
  stops: LiveTripStop[];
}

type CompactTripStop = [string, number];
type ObjectTripStop = { id: string; scheduled: number };

export function normalizeLiveTrip(payload: unknown): LiveTripDetails | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as Record<string, unknown>;
  const rawTrip = response.trip;
  if (!rawTrip || (typeof rawTrip !== "object" && !Array.isArray(rawTrip))) return null;

  const trip = Array.isArray(rawTrip)
    ? {
        id: rawTrip[0],
        lineId: rawTrip[2],
        shape: rawTrip[3],
        destination: rawTrip[4],
        stops: rawTrip[5],
      }
    : rawTrip as Record<string, unknown>;
  const rawStops = trip.stops;
  if (!Array.isArray(rawStops)) return null;

  const globalDelay = typeof response.delay === "number" && Number.isFinite(response.delay)
    ? response.delay
    : null;
  const perStopDelay = new Map<string, number>();
  if (Array.isArray(response.stops)) {
    for (const row of response.stops) {
      if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "number") {
        perStopDelay.set(row[0], row[1]);
      } else if (row && typeof row === "object") {
        const update = row as { id?: unknown; delay?: unknown };
        if (typeof update.id === "string" && typeof update.delay === "number") {
          perStopDelay.set(update.id, update.delay);
        }
      }
    }
  }

  const stops = rawStops.flatMap((rawStop): LiveTripStop[] => {
    const stop = Array.isArray(rawStop)
      ? { id: rawStop[0], scheduled: rawStop[1] }
      : rawStop as ObjectTripStop;
    if (typeof stop.id !== "string" || typeof stop.scheduled !== "number" || !Number.isFinite(stop.scheduled)) return [];
    const delayMs = perStopDelay.get(stop.id) ?? globalDelay;
    return [{
      id: stop.id,
      scheduledAt: stop.scheduled,
      arrivalAt: stop.scheduled + (delayMs ?? 0),
      delayMs,
    }];
  });
  if (!stops.length) return null;

  const rawDestination = trip.destination ?? response.destination;
  const destination = rawDestination && typeof rawDestination === "object"
    ? rawDestination as { bg?: string; en?: string }
    : null;

  return {
    id: typeof trip.id === "string" ? trip.id : "",
    lineId: typeof trip.lineId === "string" ? trip.lineId : "",
    destination,
    shape: typeof trip.shape === "string" ? trip.shape : "",
    nextStop: Number.isInteger(response.nextStop) ? Number(response.nextStop) : -1,
    delayMs: globalDelay,
    cancelled: response.delay === "cancelled",
    stops,
  };
}
