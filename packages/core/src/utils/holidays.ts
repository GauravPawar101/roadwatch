/**
 * Regional public-holiday helpers for scheduler night jobs.
 * Default calendar: India (fixed national holidays for the given year).
 */

/** Fixed-date Indian national holidays as MM-DD (excludes movable festivals). */
const INDIA_FIXED_HOLIDAYS = [
  '01-26', // Republic Day
  '08-15', // Independence Day
  '10-02', // Gandhi Jayanti
  '12-25', // Christmas
] as const;

export function getDatePartsInTimeZone(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; ymd: string; md: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '0');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '0');
  const ymd = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, ymd, md };
}

/**
 * Returns true when `date` falls on a regional public holiday in `timeZone`.
 * Extra dates may be supplied as YYYY-MM-DD in `extraHolidays`.
 */
export function isRegionalHoliday(
  date: Date,
  timeZone = 'Asia/Kolkata',
  extraHolidays: string[] = []
): boolean {
  const { ymd, md } = getDatePartsInTimeZone(date, timeZone);

  if (extraHolidays.includes(ymd)) {
    return true;
  }

  // India is the default region for RoadWatch night crons
  if (timeZone === 'Asia/Kolkata' || timeZone.startsWith('Asia/Kolkata')) {
    return (INDIA_FIXED_HOLIDAYS as readonly string[]).includes(md);
  }

  return false;
}
