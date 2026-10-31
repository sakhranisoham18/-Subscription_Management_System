/**
 * Date-only helpers. Business dates (start date, billing date, due date…) are stored as
 * PostgreSQL DATE and handled in code as JS Dates at 00:00 UTC, so no timezone shifting
 * can move a billing date. "Today" is evaluated in the configured APP_TIMEZONE.
 */
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const DAY_MS = 86_400_000;

export function dateOnly(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day));
}

/** Parses "YYYY-MM-DD" (or an ISO string / Date) into a UTC-midnight date. */
export function toDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new RangeError(`Invalid date: ${value}`);
  const result = dateOnly(Number(m[1]), Number(m[2]), Number(m[3]));
  if (result.getUTCMonth() !== Number(m[2]) - 1) throw new RangeError(`Invalid date: ${value}`);
  return result;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in the given IANA timezone, as a UTC-midnight date. */
export function todayIn(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // en-CA → YYYY-MM-DD
  return toDateOnly(parts);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / DAY_MS);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Month-end rule: a subscription remembers its "anchor day" (the day of month it started on).
 * Each monthly/yearly step lands on the anchor day, clamped to the last day of shorter months.
 *   Jan 31 → Feb 28 (29 in leap years) → Mar 31 → Apr 30 …
 *   Feb 29 (yearly) → Feb 28 next year → Feb 29 in the next leap year.
 */
export function addMonthsAnchored(date: Date, months: number, anchorDay: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return dateOnly(year, month, Math.min(anchorDay, daysInMonth(year, month)));
}

export function addBillingPeriods(
  date: Date,
  frequency: Frequency,
  interval = 1,
  anchorDay = date.getUTCDate(),
  periods = 1,
): Date {
  if (!Number.isInteger(interval) || interval < 1) throw new RangeError('Billing interval must be ≥ 1');
  const n = interval * periods;
  switch (frequency) {
    case 'DAILY':
      return addDays(date, n);
    case 'WEEKLY':
      return addDays(date, 7 * n);
    case 'MONTHLY':
      return addMonthsAnchored(date, n, anchorDay);
    case 'YEARLY':
      return addMonthsAnchored(date, 12 * n, anchorDay);
  }
}

/** The service period an invoice covers: [periodStart, nextStart − 1 day]. */
export function billingPeriod(periodStart: Date, frequency: Frequency, interval: number, anchorDay: number) {
  const nextStart = addBillingPeriods(periodStart, frequency, interval, anchorDay);
  return { periodStart, periodEnd: addDays(nextStart, -1), nextStart };
}

/**
 * Monthly recurring revenue normalisation (MRR):
 *   DAILY   → amount × 365 / 12 / interval
 *   WEEKLY  → amount × 52 / 12 / interval
 *   MONTHLY → amount / interval
 *   YEARLY  → amount / 12 / interval
 * Returned as [numerator, denominator] so callers can keep decimal precision.
 */
export function monthlyFactor(frequency: Frequency, interval = 1): [number, number] {
  switch (frequency) {
    case 'DAILY':
      return [365, 12 * interval];
    case 'WEEKLY':
      return [52, 12 * interval];
    case 'MONTHLY':
      return [1, interval];
    case 'YEARLY':
      return [1, 12 * interval];
  }
}
