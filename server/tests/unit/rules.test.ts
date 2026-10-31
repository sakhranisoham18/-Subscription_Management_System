import { describe, expect, it } from 'vitest';
import { evaluateDiscount, pickBestDiscount, type DiscountRule } from '../../src/domain/discounts';
import { canTransitionQuotation, canTransitionSubscription, invoiceStatusFromPayments, isOverdue } from '../../src/domain/lifecycle';
import { applyToInvoice, validateAllocations } from '../../src/domain/payments';
import { isStrongPassword, normalizeEmail, passwordProblems } from '../../src/domain/password';
import { hasPermission } from '../../src/domain/permissions';
import { toDateOnly } from '../../src/domain/dates';

const D = (s: string) => toDateOnly(s);

describe('password policy', () => {
  it('requires > 8 chars, upper, lower and special', () => {
    expect(isStrongPassword('Brightl@op1')).toBe(true);
    expect(isStrongPassword('Short@1A')).toBe(false); // exactly 8 → not "more than eight"
    expect(passwordProblems('alllowercase!')).toContain('Password must contain an uppercase letter');
    expect(passwordProblems('ALLUPPERCASE!')).toContain('Password must contain a lowercase letter');
    expect(passwordProblems('NoSpecialChar1')).toContain('Password must contain a special character');
  });
  it('normalises email for case-insensitive uniqueness', () => {
    expect(normalizeEmail('  Asha.Verma@Example.COM ')).toBe('asha.verma@example.com');
  });
});

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  id: 'r1',
  type: 'PERCENTAGE',
  value: '10',
  status: 'ACTIVE',
  startsAt: D('2026-01-01'),
  endsAt: D('2026-12-31'),
  usageLimit: null,
  usedCount: 0,
  minPurchase: null,
  minQuantity: null,
  scope: 'ALL',
  productId: null,
  planId: null,
  subscriptionId: null,
  ...over,
});
const ctx = (over = {}) => ({
  date: D('2026-06-01'),
  planId: 'plan-1',
  subscriptionId: 'sub-1',
  lines: [
    { productId: 'p1', quantity: 10, netAmount: '10000' },
    { productId: 'p2', quantity: 2, netAmount: '1000' },
  ],
  ...over,
});

describe('discount eligibility', () => {
  it('applies when active and within dates', () => {
    const r = evaluateDiscount(rule(), ctx());
    expect(r.eligible && r.amount.toFixed(2)).toBe('1100.00');
  });
  it('stops after expiry / before start / when inactive', () => {
    expect(evaluateDiscount(rule({ endsAt: D('2026-05-31') }), ctx()).eligible).toBe(false);
    expect(evaluateDiscount(rule({ startsAt: D('2026-07-01') }), ctx()).eligible).toBe(false);
    expect(evaluateDiscount(rule({ status: 'ARCHIVED' }), ctx()).eligible).toBe(false);
  });
  it('stops when the usage limit is reached', () => {
    expect(evaluateDiscount(rule({ usageLimit: 3, usedCount: 2 }), ctx()).eligible).toBe(true);
    const r = evaluateDiscount(rule({ usageLimit: 3, usedCount: 3 }), ctx());
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toMatch(/usage limit/);
  });
  it('enforces minimum purchase and minimum quantity', () => {
    expect(evaluateDiscount(rule({ minPurchase: '20000' }), ctx()).eligible).toBe(false);
    expect(evaluateDiscount(rule({ minQuantity: 13 }), ctx()).eligible).toBe(false);
    expect(evaluateDiscount(rule({ minQuantity: 12 }), ctx()).eligible).toBe(true);
  });
  it('product scope only discounts matching lines', () => {
    const r = evaluateDiscount(rule({ scope: 'PRODUCT', productId: 'p2' }), ctx());
    expect(r.eligible && r.eligibleLineIndexes).toEqual([1]);
    expect(r.eligible && r.amount.toFixed(2)).toBe('100.00');
    expect(evaluateDiscount(rule({ scope: 'PRODUCT', productId: 'zzz' }), ctx()).eligible).toBe(false);
  });
  it('plan and subscription scope', () => {
    expect(evaluateDiscount(rule({ scope: 'PLAN', planId: 'plan-1' }), ctx()).eligible).toBe(true);
    expect(evaluateDiscount(rule({ scope: 'PLAN', planId: 'plan-2' }), ctx()).eligible).toBe(false);
    expect(evaluateDiscount(rule({ scope: 'SUBSCRIPTION', subscriptionId: 'sub-2' }), ctx()).eligible).toBe(false);
  });
  it('picks the discount with the biggest saving', () => {
    const best = pickBestDiscount([rule({ id: 'a', value: '5' }), rule({ id: 'b', type: 'FIXED', value: '2000' }), rule({ id: 'c', value: '15' })], ctx());
    expect(best?.rule.id).toBe('b');
  });
});

describe('lifecycles', () => {
  it('subscription: Draft → Quotation → Confirmed → Active → Closed', () => {
    expect(canTransitionSubscription('DRAFT', 'QUOTATION')).toBe(true);
    expect(canTransitionSubscription('QUOTATION', 'CONFIRMED')).toBe(true);
    expect(canTransitionSubscription('CONFIRMED', 'ACTIVE')).toBe(true);
    expect(canTransitionSubscription('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransitionSubscription('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransitionSubscription('ACTIVE', 'CLOSED')).toBe(true);
  });
  it('subscription: rejects invalid transitions', () => {
    expect(canTransitionSubscription('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransitionSubscription('CLOSED', 'ACTIVE')).toBe(false);
    expect(canTransitionSubscription('CONFIRMED', 'PAUSED')).toBe(false);
    expect(canTransitionSubscription('PAUSED', 'CONFIRMED')).toBe(false);
  });
  it('quotation transitions', () => {
    expect(canTransitionQuotation('SENT', 'ACCEPTED')).toBe(true);
    expect(canTransitionQuotation('ACCEPTED', 'CONVERTED')).toBe(true);
    expect(canTransitionQuotation('CONVERTED', 'DRAFT')).toBe(false);
    expect(canTransitionQuotation('EXPIRED', 'ACCEPTED')).toBe(false);
  });
  it('invoice is Paid only when payments cover the total', () => {
    expect(invoiceStatusFromPayments('1000', '0')).toBe('CONFIRMED');
    expect(invoiceStatusFromPayments('1000', '999.99')).toBe('PARTIALLY_PAID');
    expect(invoiceStatusFromPayments('1000', '1000')).toBe('PAID');
  });
  it('overdue = open, unpaid balance, past due date', () => {
    const today = D('2026-10-31');
    expect(isOverdue({ status: 'CONFIRMED', dueDate: D('2026-10-30'), balanceDue: '10' }, today)).toBe(true);
    expect(isOverdue({ status: 'PARTIALLY_PAID', dueDate: D('2026-10-30'), balanceDue: '10' }, today)).toBe(true);
    expect(isOverdue({ status: 'CONFIRMED', dueDate: D('2026-10-31'), balanceDue: '10' }, today)).toBe(false);
    expect(isOverdue({ status: 'PAID', dueDate: D('2026-01-01'), balanceDue: '0' }, today)).toBe(false);
    expect(isOverdue({ status: 'DRAFT', dueDate: D('2026-01-01'), balanceDue: '10' }, today)).toBe(false);
  });
});

describe('payment allocation', () => {
  const invoices = [
    { id: 'i1', number: 'INV-1', customerId: 'c1', status: 'CONFIRMED' as const, balanceDue: '1000.00' },
    { id: 'i2', number: 'INV-2', customerId: 'c1', status: 'PARTIALLY_PAID' as const, balanceDue: '250.00' },
    { id: 'i3', number: 'INV-3', customerId: 'c2', status: 'CONFIRMED' as const, balanceDue: '500.00' },
    { id: 'i4', number: 'INV-4', customerId: 'c1', status: 'DRAFT' as const, balanceDue: '500.00' },
  ];
  it('accepts partial payment and split allocations', () => {
    expect(validateAllocations('400', 'c1', [{ invoiceId: 'i1', amount: '400' }], invoices)).toEqual([]);
    expect(validateAllocations('1250', 'c1', [{ invoiceId: 'i1', amount: '1000' }, { invoiceId: 'i2', amount: '250' }], invoices)).toEqual([]);
  });
  it('prevents over-allocation, wrong customer, unconfirmed invoices and mismatched totals', () => {
    expect(validateAllocations('1001', 'c1', [{ invoiceId: 'i1', amount: '1001' }], invoices)[0]).toMatch(/exceeds/);
    expect(validateAllocations('100', 'c1', [{ invoiceId: 'i3', amount: '100' }], invoices)[0]).toMatch(/different customer/);
    expect(validateAllocations('100', 'c1', [{ invoiceId: 'i4', amount: '100' }], invoices)[0]).toMatch(/cannot receive payments/);
    expect(validateAllocations('500', 'c1', [{ invoiceId: 'i1', amount: '400' }], invoices)[0]).toMatch(/must equal/);
    expect(validateAllocations('0', 'c1', [{ invoiceId: 'i1', amount: '0' }], invoices).length).toBeGreaterThan(0);
  });
  it('computes outstanding balances after partial and final payments', () => {
    const first = applyToInvoice('1180.00', '0', '500');
    expect(first.balanceDue.toFixed(2)).toBe('680.00');
    const second = applyToInvoice('1180.00', first.amountPaid, '680');
    expect(second.balanceDue.toFixed(2)).toBe('0.00');
    expect(() => applyToInvoice('1180.00', '1000', '200')).toThrow(/exceed/);
    expect(applyToInvoice('1180.00', '1180', '-1180').balanceDue.toFixed(2)).toBe('1180.00'); // void
  });
});

describe('permission matrix', () => {
  it('only admin manages staff, discounts, products and plans', () => {
    expect(hasPermission('ADMIN', 'users:manage')).toBe(true);
    expect(hasPermission('STAFF', 'users:manage')).toBe(false);
    expect(hasPermission('STAFF', 'discounts:write')).toBe(false);
    expect(hasPermission('STAFF', 'products:write')).toBe(false);
    expect(hasPermission('STAFF', 'discounts:read')).toBe(true);
  });
  it('staff handle daily operations', () => {
    for (const p of ['customers:write', 'quotations:write', 'subscriptions:write', 'invoices:write', 'payments:write', 'billing:run'] as const) {
      expect(hasPermission('STAFF', p)).toBe(true);
    }
  });
  it('customers have portal access only', () => {
    expect(hasPermission('CUSTOMER', 'portal:access')).toBe(true);
    expect(hasPermission('CUSTOMER', 'invoices:read')).toBe(false);
    expect(hasPermission('CUSTOMER', 'customers:read')).toBe(false);
  });
});
