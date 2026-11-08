export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type Catchability = "comfortable" | "tight" | "unlikely";

const earthRadiusMeters = 6_371_000;
const defaultWalkingSpeedKmh = 4.8;
const urbanWalkingDetourFactor = 1.25;

export function estimateWalkingMinutes(
  from: Coordinates,
  to: Coordinates,
  walkingSpeedKmh = defaultWalkingSpeedKmh,
  detourFactor = urbanWalkingDetourFactor,
): number | null {
  const validCoordinates = (point: Coordinates) =>
    Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 &&
    Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
  if (!validCoordinates(from) || !validCoordinates(to) ||
      !Number.isFinite(walkingSpeedKmh) || walkingSpeedKmh <= 0 ||
      !Number.isFinite(detourFactor) || detourFactor < 1) return null;

  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  const distanceMeters = 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, haversine)));
  const walkingMetersPerMinute = walkingSpeedKmh * 1000 / 60;
  return Math.ceil(distanceMeters * detourFactor / walkingMetersPerMinute);
}

export function assessCatchability(
  minutesUntilBus: number,
  walkingMinutes: number,
  bufferMinutes = 2,
): Catchability | null {
  if (![minutesUntilBus, walkingMinutes, bufferMinutes].every(Number.isFinite) ||
      minutesUntilBus < 0 || walkingMinutes < 0 || bufferMinutes < 0) return null;

  const spareMinutes = minutesUntilBus - walkingMinutes;
  if (spareMinutes < 0) return "unlikely";
  return spareMinutes <= bufferMinutes ? "tight" : "comfortable";
}
