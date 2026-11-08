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

export type CalendarRow = Record<string, string>;
export interface ScheduledStopTime {
  tripId: string;
  serviceId: string;
  route: string;
  headsign: string;
  departureTime: string;
}

const weekdayColumns = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function getActiveServices(calendar: CalendarRow[], exceptions: CalendarRow[], date: string, weekday: number): Set<string> {
  const active = new Set<string>();
  for (const row of calendar) {
    if (date >= row.start_date && date <= row.end_date && row[weekdayColumns[weekday]] === "1") active.add(row.service_id);
  }
  for (const row of exceptions) {
    if (row.date !== date) continue;
    if (row.exception_type === "1") active.add(row.service_id);
    if (row.exception_type === "2") active.delete(row.service_id);
  }
  return active;
}

export function getPreviousServiceDay(date: string, weekday: number): { date: string; weekday: number } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  const padded = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${previous.getUTCFullYear()}${padded(previous.getUTCMonth() + 1)}${padded(previous.getUTCDate())}`,
    weekday: (weekday + 6) % 7,
  };
}

export function shiftOvernightGtfsTimeToCurrentDay(value: string): string | null {
  const seconds = parseGtfsTime(value);
  if (seconds === null || seconds < 86_400 || seconds >= 172_800) return null;
  const currentDaySeconds = seconds - 86_400;
  const hours = Math.floor(currentDaySeconds / 3600);
  const minutes = Math.floor((currentDaySeconds % 3600) / 60);
  const remainder = currentDaySeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function getServiceDayScheduleRows(
  rows: ScheduledStopTime[],
  calendar: CalendarRow[],
  exceptions: CalendarRow[],
  date: string,
  weekday: number,
): Omit<ScheduledStopTime, "serviceId">[] {
  const activeToday = getActiveServices(calendar, exceptions, date, weekday);
  const previousDay = getPreviousServiceDay(date, weekday);
  const activePreviousDay = getActiveServices(calendar, exceptions, previousDay.date, previousDay.weekday);

  return rows.flatMap(({ serviceId, ...row }) => {
    const serviceRows = activeToday.has(serviceId) ? [row] : [];
    if (activePreviousDay.has(serviceId)) {
      const departureTime = shiftOvernightGtfsTimeToCurrentDay(row.departureTime);
      if (departureTime) serviceRows.push({ ...row, departureTime });
    }
    return serviceRows;
  });
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
        departureSeconds,
        minutesAway: Math.ceil((departureSeconds - currentSeconds) / 60),
      };
    })
    .sort((left, right) => left.departureSeconds - right.departureSeconds)
    .slice(0, limit)
    .map((arrival) => ({
      tripId: arrival.tripId,
      route: arrival.route,
      headsign: arrival.headsign,
      departureTime: arrival.departureTime,
      minutesAway: arrival.minutesAway,
    }));
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
