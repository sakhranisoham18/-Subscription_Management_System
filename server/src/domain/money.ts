import Decimal from 'decimal.js';

/**
 * Money rules (documented in README → "Financial rules"):
 *  - All arithmetic uses decimal.js (never binary floating point).
 *  - Every stored monetary value is rounded to 2 decimal places, ROUND_HALF_UP.
 *  - Rounding happens per line (line discount, line tax) and totals are sums of rounded lines,
 *    so the printed invoice always adds up exactly.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export type MoneyInput = Decimal.Value | { toString(): string };

export const d = (v: MoneyInput | null | undefined): Decimal =>
  new Dec(v === null || v === undefined ? 0 : typeof v === 'object' ? v.toString() : v);

export const round2 = (v: MoneyInput): Decimal => d(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const ZERO = new Dec(0);

export const sum = (values: MoneyInput[]): Decimal => values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Dec(0));

export const min = (a: MoneyInput, b: MoneyInput): Decimal => Decimal.min(d(a), d(b));
export const max = (a: MoneyInput, b: MoneyInput): Decimal => Decimal.max(d(a), d(b));

/** Fixed 2-dp string for API responses and Prisma writes. */
export const toMoneyString = (v: MoneyInput): string => round2(v).toFixed(2);

export function assertNonNegative(v: MoneyInput, label: string): void {
  if (d(v).isNegative()) throw new RangeError(`${label} cannot be negative`);
}
