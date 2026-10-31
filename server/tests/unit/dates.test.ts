import { describe, expect, it } from 'vitest';
import { addBillingPeriods, billingPeriod, formatDateOnly, monthlyFactor, toDateOnly, todayIn } from '../../src/domain/dates';

const D = (s: string) => toDateOnly(s);
const F = (d: Date) => formatDateOnly(d);

describe('recurring billing dates', () => {
  it('daily and weekly steps', () => {
    expect(F(addBillingPeriods(D('2026-12-31'), 'DAILY'))).toBe('2027-01-01');
    expect(F(addBillingPeriods(D('2026-12-28'), 'WEEKLY'))).toBe('2027-01-04');
    expect(F(addBillingPeriods(D('2026-01-01'), 'WEEKLY', 2))).toBe('2026-01-15');
  });

  it('monthly from the report example: 1 Nov → 1 Dec → 1 Jan', () => {
    const dec = addBillingPeriods(D('2026-11-01'), 'MONTHLY');
    expect(F(dec)).toBe('2026-12-01');
    expect(F(addBillingPeriods(dec, 'MONTHLY'))).toBe('2027-01-01');
  });

  it('month-end: anchor day 31 clamps to short months and returns to 31', () => {
    const anchor = 31;
    const feb = addBillingPeriods(D('2026-01-31'), 'MONTHLY', 1, anchor);
    expect(F(feb)).toBe('2026-02-28');
    const mar = addBillingPeriods(feb, 'MONTHLY', 1, anchor);
    expect(F(mar)).toBe('2026-03-31');
    expect(F(addBillingPeriods(mar, 'MONTHLY', 1, anchor))).toBe('2026-04-30');
  });

  it('month-end in a leap year', () => {
    expect(F(addBillingPeriods(D('2028-01-31'), 'MONTHLY', 1, 31))).toBe('2028-02-29');
  });

  it('yearly: 29 Feb → 28 Feb → 29 Feb in the next leap year', () => {
    const y1 = addBillingPeriods(D('2028-02-29'), 'YEARLY', 1, 29);
    expect(F(y1)).toBe('2029-02-28');
    expect(F(addBillingPeriods(D('2028-02-29'), 'YEARLY', 1, 29, 4))).toBe('2032-02-29');
  });

  it('year-end rollover for monthly', () => {
    expect(F(addBillingPeriods(D('2026-12-15'), 'MONTHLY'))).toBe('2027-01-15');
    expect(F(addBillingPeriods(D('2026-11-30'), 'MONTHLY', 3, 30))).toBe('2027-02-28');
  });

  it('billing period end is the day before the next start', () => {
    const p = billingPeriod(D('2026-01-31'), 'MONTHLY', 1, 31);
    expect(F(p.periodEnd)).toBe('2026-02-27');
    expect(F(p.nextStart)).toBe('2026-02-28');
  });

  it('rejects invalid dates and intervals', () => {
    expect(() => toDateOnly('2026-02-30')).toThrow();
    expect(() => addBillingPeriods(D('2026-01-01'), 'MONTHLY', 0)).toThrow();
  });

  it("evaluates 'today' in the business timezone", () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in India (UTC+05:30)
    const now = new Date('2026-10-31T20:00:00Z');
    expect(F(todayIn('Asia/Kolkata', now))).toBe('2026-11-01');
    expect(F(todayIn('UTC', now))).toBe('2026-10-31');
  });
});

describe('MRR normalisation factors', () => {
  it('normalises each frequency to a month', () => {
    expect(monthlyFactor('DAILY')).toEqual([365, 12]);
    expect(monthlyFactor('WEEKLY')).toEqual([52, 12]);
    expect(monthlyFactor('MONTHLY')).toEqual([1, 1]);
    expect(monthlyFactor('YEARLY')).toEqual([1, 12]);
    expect(monthlyFactor('MONTHLY', 3)).toEqual([1, 3]);
  });
});
