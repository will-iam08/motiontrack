// Helpers for the progress screen. The API returns one row per UTC date and
// exercise; date keys are compared as plain "YYYY-MM-DD" strings so they are
// never shifted by the browser's time zone.
export const RANGES = [
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: 'all', label: 'All time', days: null },
];

// Rep exercises have no duration, so progress charts these measures.
export const METRICS = [
  { value: 'workouts', label: 'Completed exercises' },
  { value: 'repetitions', label: 'Repetitions' },
  { value: 'duration_seconds', label: 'Active time' },
];

const DAY_MS = 86400000;

export function utcDateKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  return utcDateKey(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS);
}

export function rangeStart(days, now = Date.now()) {
  return days ? addDays(utcDateKey(now), -(days - 1)) : null;
}

export function filterDaily(daily, days, now = Date.now()) {
  const start = rangeStart(days, now);
  const end = utcDateKey(now);
  return start ? daily.filter(row => row.date >= start && row.date <= end) : daily;
}

export function filterHeartRate(points, days, now = Date.now()) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const valid = points.filter(point => point && typeof point.date === 'string' && point.date.length >= 10);
  const start = rangeStart(days, now);
  const end = utcDateKey(now);
  return start ? valid.filter(point => point.date >= start && point.date <= end) : valid;
}

export function sumRows(rows) {
  return rows.reduce(
    (totals, row) => ({
      workouts: totals.workouts + row.workouts,
      repetitions: totals.repetitions + row.repetitions,
      duration_seconds: totals.duration_seconds + row.duration_seconds,
    }),
    { workouts: 0, repetitions: 0, duration_seconds: 0 },
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return day ? `${MONTHS[month - 1]} ${day}` : `${MONTHS[month - 1]} ${year}`;
}

// One bucket per day (days without a completed workout count as zero), or one
// per month when "All time" covers more than about three months.
export function buildBuckets(daily, days, now = Date.now()) {
  const rows = filterDaily(daily, days, now);
  const end = utcDateKey(now);
  const start = rangeStart(days, now) ?? rows.reduce((min, row) => (row.date < min ? row.date : min), end);
  const span = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
  const monthly = span > 92;
  const buckets = new Map();
  if (monthly) {
    let [year, month] = start.split('-').map(Number);
    const [endYear, endMonth] = end.split('-').map(Number);
    while (year < endYear || (year === endYear && month <= endMonth)) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      buckets.set(key, { key, label: formatDateKey(key), workouts: 0, repetitions: 0, duration_seconds: 0 });
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  } else {
    for (let i = 0; i < span; i += 1) {
      const key = addDays(start, i);
      buckets.set(key, { key, label: formatDateKey(key), workouts: 0, repetitions: 0, duration_seconds: 0 });
    }
  }
  for (const row of rows) {
    const bucket = buckets.get(monthly ? row.date.slice(0, 7) : row.date);
    if (!bucket) continue;
    bucket.workouts += row.workouts;
    bucket.repetitions += row.repetitions;
    bucket.duration_seconds += row.duration_seconds;
  }
  return { buckets: [...buckets.values()], monthly };
}
