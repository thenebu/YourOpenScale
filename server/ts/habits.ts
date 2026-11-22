/** When and how often someone weighs themselves, and whether the readings are
 * comparable. Pure functions over reading times; no I/O.
 */
export type Weighing = { t: number; zone: string | null };
/** Local hours counted as "morning" (start inclusive, end exclusive). */
export const MORNING = { from: 4, to: 10 } as const;
/** Share of weigh-ins inside the morning window needed to call them comparable. */
export const COMPARABLE_SHARE = 0.7;
export const MIN_READINGS = 10;

const formats = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function localParts(t: number, zone: string) {
  let format = formats.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hourCycle: "h23",
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return localParts(t, "UTC");
    }
    formats.set(zone, format);
  }
  const p = Object.fromEntries(
    format.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]),
  );
  return {
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: Math.max(0, WEEKDAYS.indexOf(p.weekday)),
    month: `${p.year}-${p.month}`,
    day: `${p.year}-${p.month}-${p.day}`,
  };
}

export type Habits = {
  count: number;
  days: number;
  hours: number[]; // 24 buckets, local hour
  weekdays: number[]; // Mon..Sun
  months: { key: string; count: number }[]; // consecutive months, oldest first
  morningShare: number;
  medianMinutes: number;
  perWeek: number;
  longestGapDays: number;
  zoneAssumed: boolean;
  verdict: "unknown" | "comparable" | "mixed";
};

export function weighHabits(items: Weighing[]): Habits {
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  const monthCounts = new Map<string, number>();
  const days = new Set<string>();
  const minutes: number[] = [];
  let morning = 0;
  let zoneAssumed = false;
  for (const item of items) {
    if (!item.zone) zoneAssumed = true;
    const l = localParts(item.t, item.zone || "UTC");
    const hour = Math.floor(l.minutes / 60);
    hours[hour]++;
    weekdays[l.weekday]++;
    monthCounts.set(l.month, (monthCounts.get(l.month) ?? 0) + 1);
    days.add(l.day);
    minutes.push(l.minutes);
    if (hour >= MORNING.from && hour < MORNING.to) morning++;
  }
  // Fill empty months so pauses are visible in the chart.
  const months: Habits["months"] = [];
  const keys = [...monthCounts.keys()].sort();
  if (keys.length) {
    let [y, m] = keys[0].split("-").map(Number);
    const [ey, em] = keys[keys.length - 1].split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      months.push({ key, count: monthCounts.get(key) ?? 0 });
      if (++m > 12) [y, m] = [y + 1, 1];
    }
  }
  const times = items.map((i) => i.t).sort((a, b) => a - b);
  let longest = 0;
  for (let i = 1; i < times.length; i++)
    longest = Math.max(longest, (times[i] - times[i - 1]) / 86400);
  const span =
    times.length > 1 ? (times[times.length - 1] - times[0]) / 86400 : 0;
  minutes.sort((a, b) => a - b);
  const share = items.length ? morning / items.length : 0;
  return {
    count: items.length,
    days: days.size,
    hours,
    weekdays,
    months,
    morningShare: share,
    medianMinutes: minutes.length ? minutes[Math.floor(minutes.length / 2)] : 0,
    perWeek: span >= 7 ? (items.length / span) * 7 : items.length,
    longestGapDays: Math.round(longest),
    zoneAssumed,
    verdict:
      items.length < MIN_READINGS
        ? "unknown"
        : share >= COMPARABLE_SHARE
          ? "comparable"
          : "mixed",
  };
}

export const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
