/** Currency/date formatting used everywhere in the UI. Amounts arrive from the API as decimal strings. */
let currency = 'INR';
let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const setLocaleSettings = (c: string, tz?: string) => {
  currency = c || 'INR';
  if (tz) timezone = tz;
};
export const getCurrency = () => currency;

const moneyFormatters = new Map<string, Intl.NumberFormat>();
function fmt(cur: string, compact = false) {
  const key = `${cur}-${compact}`;
  if (!moneyFormatters.has(key)) {
    moneyFormatters.set(
      key,
      new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: cur,
        ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      }),
    );
  }
  return moneyFormatters.get(key)!;
}

export const money = (value: string | number | null | undefined, cur = currency) => fmt(cur).format(Number(value ?? 0));
export const moneyCompact = (value: string | number | null | undefined, cur = currency) => fmt(cur, true).format(Number(value ?? 0));

/** Business dates (YYYY-MM-DD or ISO at UTC midnight) are shown without timezone shifting. */
export function date(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Timestamps (created/updated/events) are shown in the user's configured timezone. */
export function dateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

export const isoDate = (value: string | Date | null | undefined) => {
  if (!value) return '';
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
};

export const todayIso = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts;
};

export const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const percent = (v: string | number) => `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

export const frequencyLabel: Record<string, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' };
export const methodLabel: Record<string, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  CASH: 'Cash',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

const UNIT: Record<string, string> = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };
export const intervalLabel = (freq: string, interval = 1) => (interval > 1 ? `Every ${interval} ${UNIT[freq]}s` : frequencyLabel[freq]);
export const periodUnit = (freq: string, n = 1) => `${UNIT[freq]}${n === 1 ? '' : 's'}`;
