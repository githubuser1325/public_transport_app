import { NextResponse } from "next/server";
import { getLiveStopArrival } from "@/lib/live-arrival";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const vehicleId = search.get("vehicleId");
  const stopId = search.get("stopId");
  if (!vehicleId || vehicleId.length > 80 || !stopId || !/^\d+$/.test(stopId)) {
    return NextResponse.json({ error: "A valid vehicleId and stopId are required." }, { status: 400 });
  }

  try {
    const url = `https://api.livetransport.eu/plovdiv/vehicle/${encodeURIComponent(vehicleId)}/trip`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return NextResponse.json({ available: false });

    const trip = await response.json();
    const arrival = getLiveStopArrival(trip, stopId);
    if (!arrival) return NextResponse.json({ available: false });

    return NextResponse.json({
      available: true,
      ...arrival,
      lineId: trip.trip?.lineId,
      destination: trip.destination ?? trip.trip?.destination ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Realtime arrival lookup failed." }, { status: 502 });
  }
}