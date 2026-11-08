import type { Coordinates } from "./catchability";

export interface GeolocationPort {
  getCurrentPosition(
    success: (position: { coords: Coordinates }) => void,
    error: (error: { code: number }) => void,
    options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number },
  ): void;
}

export type LocationResult =
  | { status: "success"; coordinates: Coordinates }
  | { status: "error"; message: string };

export function readCurrentLocation(
  geolocation: GeolocationPort | undefined,
  complete: (result: LocationResult) => void,
): void {
  if (!geolocation) {
    complete({ status: "error", message: "Location is not available in this browser." });
    return;
  }
  geolocation.getCurrentPosition(
    ({ coords }) => complete({ status: "success", coordinates: coords }),
    (error) => complete({
      status: "error",
      message: error.code === 1
        ? "Location access was declined. You can enable it in browser settings."
        : error.code === 3
          ? "Location request timed out. Try again."
          : "Could not get your location. Try again.",
    }),
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
  );
}
