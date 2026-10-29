import { NextResponse } from "next/server";
import { normalizeLiveTrip } from "@/lib/live-arrival";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const vehicleId = new URL(request.url).searchParams.get("vehicleId");
  if (!vehicleId || vehicleId.length > 80) {
    return NextResponse.json({ error: "A valid vehicleId is required." }, { status: 400 });
  }

  try {
    const url = `https://api.livetransport.eu/plovdiv/vehicle/${encodeURIComponent(vehicleId)}/trip`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return NextResponse.json({ available: false });

    const trip = normalizeLiveTrip(await response.json());
    return NextResponse.json({ available: Boolean(trip), trip });
  } catch {
    return NextResponse.json({ error: "Realtime trip lookup failed." }, { status: 502 });
  }
}