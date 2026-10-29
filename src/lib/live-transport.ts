export interface LiveVehicle {
  id: string;
  type: string;
  lineId: string;
  blockId: string;
  destination: { bg?: string; en?: string } | null;
  delayMs: number | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speedKmh: number | null;
  lastUpdated: number;
}

const staleAfterMs = 5 * 60 * 1000;

export function parseLiveTransportMessage(payload: unknown): LiveVehicle[] {
  let parsed = payload;
  if (typeof payload === "string") {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return [];
    }
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : [];

  return rows.flatMap((row): LiveVehicle[] => {
    if (!Array.isArray(row) || row.length < 10 || row[1] !== "bus") return [];
    const [id, type, lineId, blockId, destination, delay, coordinates, bearing, speed, lastUpdated] = row;
    if (
      typeof id !== "string" ||
      typeof lineId !== "string" ||
      !Array.isArray(coordinates) ||
      typeof coordinates[0] !== "number" ||
      typeof coordinates[1] !== "number" ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) ||
      typeof lastUpdated !== "number" ||
      !Number.isFinite(lastUpdated)
    ) return [];

    const parsedDestination = destination && typeof destination === "object"
      ? destination as { bg?: string; en?: string }
      : null;

    return [{
      id,
      type,
      lineId,
      blockId: typeof blockId === "string" ? blockId : "",
      destination: parsedDestination,
      delayMs: typeof delay === "number" && Number.isFinite(delay) ? delay : null,
      latitude: coordinates[0],
      longitude: coordinates[1],
      bearing: typeof bearing === "number" && Number.isFinite(bearing) ? bearing : null,
      speedKmh: typeof speed === "number" && Number.isFinite(speed) ? speed : null,
      lastUpdated,
    }];
  });
}

export function mergeLiveVehicleUpdates(
  current: LiveVehicle[],
  updates: LiveVehicle[],
  now = Date.now(),
): LiveVehicle[] {
  const merged = new Map(current.map((vehicle) => [vehicle.id, vehicle]));
  for (const vehicle of updates) merged.set(vehicle.id, vehicle);
  return [...merged.values()].filter((vehicle) => now - vehicle.lastUpdated <= staleAfterMs);
}