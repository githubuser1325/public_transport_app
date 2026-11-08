import { NextResponse } from "next/server";
import { matchesLiveTripLine, normalizeLiveTrip } from "@/lib/live-arrival";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const vehicleId = search.get("vehicleId");
  const expectedLineId = search.get("lineId");
  if (!vehicleId || vehicleId.length > 80 || (expectedLineId && expectedLineId.length > 80)) {
    return NextResponse.json({ error: "A valid vehicleId is required." }, { status: 400 });
  }

  try {
    const url = `https://api.livetransport.eu/plovdiv/vehicle/${encodeURIComponent(vehicleId)}/trip`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return NextResponse.json({ available: false, reason: "upstream_unavailable" }, { status: 502 });

    const trip = normalizeLiveTrip(await response.json());
    if (trip && expectedLineId && !matchesLiveTripLine(trip.lineId, expectedLineId)) {
      return NextResponse.json({ available: false, reason: "trip_line_mismatch", trip: null });
    }
    return NextResponse.json({ available: Boolean(trip), reason: trip ? undefined : "trip_data_unavailable", trip });
  } catch {
    return NextResponse.json({ available: false, reason: "upstream_error", error: "Realtime trip lookup failed." }, { status: 502 });
  }
}
