export function getTransitRequestPath(stopId?: string): string {
  return stopId ? `/api/transit?stopId=${encodeURIComponent(stopId)}` : "/api/transit";
}
