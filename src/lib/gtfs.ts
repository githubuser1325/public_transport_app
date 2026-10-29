export interface Stop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Arrival {
  tripId: string;
  route: string;
  headsign: string;
  departureTime: string;
  minutesAway: number;
}

export function parseGtfsTime(value: string): number | null {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

export function getUpcomingArrivals(rows: Array<{
  tripId: string;
  route: string;
  headsign: string;
  departureTime: string;
}>,
  currentSeconds: number,
  limit = 8,
): Arrival[] {
  return rows
    .flatMap((row) => {
      const departureSeconds = parseGtfsTime(row.departureTime);
      if (departureSeconds === null || departureSeconds < currentSeconds) return [];

      return {
        tripId: row.tripId,
        route: row.route,
        headsign: row.headsign,
        departureTime: row.departureTime,
        minutesAway: Math.ceil((departureSeconds - currentSeconds) / 60),
      };
    })
    .sort((left, right) => left.minutesAway - right.minutesAway)
    .slice(0, limit);
}

export function getPlovdivClock(date = new Date()): { date: string; seconds: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    date: `${value("year")}${value("month")}${value("day")}`,
    seconds: Number(value("hour")) * 3600 + Number(value("minute")) * 60 + Number(value("second")),
    weekday: weekdays.indexOf(value("weekday")),
  };
}