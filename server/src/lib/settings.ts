import { prisma } from './prisma';
import { env } from '../config/env';
import { todayIn } from '../domain/dates';

export interface AppSettings {
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyTaxId: string;
  currency: string;
  timezone: string;
  invoiceDueDays: number;
  autoConfirmRecurringInvoices: boolean;
  quotationValidityDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'Brightloop Software',
  companyAddress: '4th Floor, Hazratganj Business Centre, Lucknow, Uttar Pradesh 226001, India',
  companyEmail: 'billing@brightloop.example',
  companyTaxId: '09ABCDE1234F1Z5',
  currency: 'INR',
  timezone: env.APP_TIMEZONE,
  invoiceDueDays: 15,
  autoConfirmRecurringInvoices: false,
  quotationValidityDays: 30,
};

let cache: { value: AppSettings; at: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.setting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const value: AppSettings = {
    companyName: map.companyName ?? DEFAULT_SETTINGS.companyName,
    companyAddress: map.companyAddress ?? DEFAULT_SETTINGS.companyAddress,
    companyEmail: map.companyEmail ?? DEFAULT_SETTINGS.companyEmail,
    companyTaxId: map.companyTaxId ?? DEFAULT_SETTINGS.companyTaxId,
    currency: map.currency ?? DEFAULT_SETTINGS.currency,
    timezone: map.timezone ?? DEFAULT_SETTINGS.timezone,
    invoiceDueDays: map.invoiceDueDays ? Number(map.invoiceDueDays) : DEFAULT_SETTINGS.invoiceDueDays,
    autoConfirmRecurringInvoices: map.autoConfirmRecurringInvoices
      ? map.autoConfirmRecurringInvoices === 'true'
      : DEFAULT_SETTINGS.autoConfirmRecurringInvoices,
    quotationValidityDays: map.quotationValidityDays
      ? Number(map.quotationValidityDays)
      : DEFAULT_SETTINGS.quotationValidityDays,
  };
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(patch: Partial<AppSettings>) {
  await prisma.$transaction(
    Object.entries(patch)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) =>
        prisma.setting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } }),
      ),
  );
  cache = null;
  return getSettings();
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Business "today" in the configured timezone (UTC-midnight date). */
export async function businessToday(): Promise<Date> {
  const s = await getSettings();
  return todayIn(s.timezone);
}
