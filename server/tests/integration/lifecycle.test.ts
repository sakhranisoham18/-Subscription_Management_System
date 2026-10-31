import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeSubscription, addDays, api, bearer, fixtures, login, PASSWORD, prisma, TODAY } from './helpers';
import { processExpirations, runBilling } from '../../src/services/billing';
import { formatDateOnly } from '../../src/domain/dates';

let fx: Awaited<ReturnType<typeof fixtures>>;
let staffT: string;
let adminT: string;
const D = formatDateOnly;

const mkSub = (planId = fx.plan.id, customerId = fx.custA.id, start = TODAY) =>
  activeSubscription(staffT, customerId, planId, fx.product.id, fx.variant.id, D(start));

beforeAll(async () => {
  fx = await fixtures();
  [staffT, adminT] = await Promise.all([login('staff@test.local'), login('admin@test.local')]);
});
afterAll(() => prisma.$disconnect());

describe('end of term: auto-close, auto-renew, or leave for staff', () => {
  it('auto-closes an expired subscription (reason EXPIRED) and stops billing it', async () => {
    const id = await mkSub();
    await prisma.subscription.update({ where: { id }, data: { endDate: addDays(TODAY, -1), autoClose: true, autoRenew: false, nextBillingDate: addDays(TODAY, 20) } });
    const r = await processExpirations(TODAY);
    expect(r.closed).toBeGreaterThanOrEqual(1);
    const s = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(s.status).toBe('CLOSED');
    expect(s.closeReason).toBe('EXPIRED');
    expect(s.nextBillingDate).toBeNull();
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: id, message: { contains: 'Closed automatically' } } })).toBe(1);
  });

  it('auto-renews an expired subscription instead of closing it when configured', async () => {
    const id = await mkSub();
    await prisma.subscription.update({ where: { id }, data: { endDate: addDays(TODAY, -1), autoClose: true, autoRenew: true, nextBillingDate: addDays(TODAY, 20) } });
    const r = await processExpirations(TODAY);
    expect(r.renewed).toBeGreaterThanOrEqual(1);
    const s = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(s.status).toBe('ACTIVE');
    expect(s.endDate! >= TODAY).toBe(true);
    expect(await prisma.subscriptionEvent.count({ where: { subscriptionId: id, type: 'RENEWED' } })).toBe(1);
  });

  it('leaves the subscription for staff when neither auto-close nor auto-renew is set — but never bills past the end date', async () => {
    const id = await mkSub();
    await prisma.subscription.update({ where: { id }, data: { endDate: addDays(TODAY, -3), autoClose: false, autoRenew: false, nextBillingDate: addDays(TODAY, -1) } });
    await processExpirations(TODAY);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
    await runBilling({ trigger: 'MANUAL' });
    expect(await prisma.invoice.count({ where: { subscriptionId: id } })).toBe(0);
  });

  it('marks unanswered sent quotations as expired after their validity date, and refuses acceptance', async () => {
    const q = await prisma.quotation.create({
      data: { number: 'QT-TEST-EXP', customerId: fx.custA.id, planId: fx.plan.id, quotationDate: addDays(TODAY, -40), validityDays: 30, validUntil: addDays(TODAY, -10), status: 'SENT', subtotal: '100', total: '118', taxTotal: '18' },
    });
    const r = await processExpirations(TODAY);
    expect(r.quotationsExpired).toBeGreaterThanOrEqual(1);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('EXPIRED');
    const res = await api().post(`/api/v1/quotations/${q.id}/accept`).set(bearer(staffT));
    expect(res.status).toBe(422);
  });
});

describe('pause and resume', () => {
  it('billing skips a paused subscription, and resuming after a long pause does NOT bill the paused periods', async () => {
    const id = await mkSub(fx.plan.id, fx.custA.id, addDays(TODAY, -45)); // next billing date is 45 days ago
    await api().post(`/api/v1/subscriptions/${id}/pause`).set(bearer(staffT)).send({ reason: 'test' }).expect(200);
    await runBilling({ trigger: 'MANUAL' });
    expect(await prisma.invoice.count({ where: { subscriptionId: id } })).toBe(0);

    await api().post(`/api/v1/subscriptions/${id}/resume`).set(bearer(staffT)).expect(200);
    const resumed = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(D(resumed.nextBillingDate!)).toBe(D(TODAY)); // re-based to the resume date
    expect(resumed.billingAnchorDay).toBe(TODAY.getUTCDate());

    await runBilling({ trigger: 'MANUAL' });
    const invoices = await prisma.invoice.findMany({ where: { subscriptionId: id } });
    expect(invoices).toHaveLength(1); // one invoice for the new period, not three catch-up invoices
    expect(D(invoices[0].periodStart!)).toBe(D(TODAY));
  });

  it('resuming when the next billing date is still in the future keeps the schedule', async () => {
    const id = await mkSub();
    await runBilling({ trigger: 'MANUAL' }); // bills today's period, next date moves a month ahead
    const before = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    await api().post(`/api/v1/subscriptions/${id}/pause`).set(bearer(staffT)).send({}).expect(200);
    await api().post(`/api/v1/subscriptions/${id}/resume`).set(bearer(staffT)).expect(200);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(D(after.nextBillingDate!)).toBe(D(before.nextBillingDate!));
  });

  it('only paused subscriptions can be resumed and only active ones paused', async () => {
    const id = await mkSub();
    expect((await api().post(`/api/v1/subscriptions/${id}/resume`).set(bearer(staffT))).status).toBe(422);
    await api().post(`/api/v1/subscriptions/${id}/pause`).set(bearer(staffT)).send({}).expect(200);
    expect((await api().post(`/api/v1/subscriptions/${id}/pause`).set(bearer(staffT)).send({})).status).toBe(422);
  });
});

describe('plan lifecycle options are enforced', () => {
  it('rejects pause / early close / renew when the plan does not allow them', async () => {
    const plan = await prisma.subscriptionPlan.create({
      data: { name: 'Locked plan', billingFrequency: 'MONTHLY', price: '500', availableFrom: addDays(TODAY, -100), allowPause: false, allowEarlyClose: false, allowRenew: false, taxRuleId: fx.tax.id },
    });
    const id = await mkSub(plan.id, fx.custB.id);
    expect((await api().post(`/api/v1/subscriptions/${id}/pause`).set(bearer(staffT)).send({})).status).toBe(422);
    expect((await api().post(`/api/v1/subscriptions/${id}/close`).set(bearer(staffT)).send({ reason: 'x' })).status).toBe(422);
    expect((await api().post(`/api/v1/subscriptions/${id}/renew`).set(bearer(staffT)).send({})).status).toBe(422);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
  });

  it('renew extends an active subscription and re-opens an expired one', async () => {
    const id = await mkSub();
    await prisma.subscription.update({ where: { id }, data: { endDate: addDays(TODAY, 10) } });
    const ext = await api().post(`/api/v1/subscriptions/${id}/renew`).set(bearer(staffT)).send({ periods: 3 });
    expect(ext.status).toBe(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).endDate! > addDays(TODAY, 60)).toBe(true);

    await prisma.subscription.update({ where: { id }, data: { status: 'CLOSED', closeReason: 'EXPIRED', endDate: addDays(TODAY, -5), nextBillingDate: null } });
    const reopened = await api().post(`/api/v1/subscriptions/${id}/renew`).set(bearer(staffT)).send({ periods: 12 });
    expect(reopened.status).toBe(200);
    const s = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(s.status).toBe('ACTIVE');
    expect(D(s.nextBillingDate!)).toBe(D(TODAY));
    // a subscription cancelled by choice cannot be renewed
    await prisma.subscription.update({ where: { id }, data: { status: 'CLOSED', closeReason: 'CLOSED_EARLY' } });
    expect((await api().post(`/api/v1/subscriptions/${id}/renew`).set(bearer(staffT)).send({})).status).toBe(422);
  });

  it('customer requests are validated against the plan and cannot be duplicated while pending', async () => {
    const plan = await prisma.subscriptionPlan.create({
      data: { name: 'No pause', billingFrequency: 'MONTHLY', price: '500', availableFrom: addDays(TODAY, -100), allowPause: false, taxRuleId: fx.tax.id },
    });
    const id = await mkSub(plan.id, fx.custA.id);
    const cT = await login('custa@test.local', PASSWORD);
    expect((await api().post(`/api/v1/portal/subscriptions/${id}/requests`).set(bearer(cT)).send({ type: 'PAUSE' })).status).toBe(422);
    expect((await api().post(`/api/v1/portal/subscriptions/${id}/requests`).set(bearer(cT)).send({ type: 'CANCEL' })).status).toBe(201);
    expect((await api().post(`/api/v1/portal/subscriptions/${id}/requests`).set(bearer(cT)).send({ type: 'CANCEL' })).status).toBe(409);
  });
});

describe('concurrent payments (money integrity under races)', () => {
  let invoiceId: string;
  beforeAll(async () => {
    const res = await api().post('/api/v1/invoices').set(bearer(staffT)).send({ customerId: fx.custB.id, lines: [{ type: 'PRODUCT', productId: fx.product.id, quantity: 1 }] });
    invoiceId = res.body.data.id; // 2000 + 18% = 2360
    await api().post(`/api/v1/invoices/${invoiceId}/confirm`).set(bearer(staffT)).send({}).expect(200);
  });

  it('five simultaneous ₹600 payments against a ₹2,360 invoice: exactly three succeed, balance never goes negative', async () => {
    const pay = (n: number) =>
      api().post('/api/v1/payments').set(bearer(staffT)).send({ customerId: fx.custB.id, method: 'UPI', amount: '600.00', paymentDate: D(TODAY), reference: `RACE-${n}`, allocations: [{ invoiceId, amount: '600.00' }] });
    const results = await Promise.all([1, 2, 3, 4, 5].map(pay));
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    expect(ok).toBe(3);
    expect(rejected).toBe(2);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.amountPaid.toFixed(2)).toBe('1800.00');
    expect(inv.balanceDue.toFixed(2)).toBe('560.00');
    expect(inv.status).toBe('PARTIALLY_PAID');
    const allocated = await prisma.paymentAllocation.aggregate({ where: { invoiceId, payment: { status: 'COMPLETED' } }, _sum: { amount: true } });
    expect(allocated._sum.amount!.toFixed(2)).toBe(inv.amountPaid.toFixed(2)); // ledger and invoice agree
  });

  it('two simultaneous payments with the same reference: exactly one is recorded', async () => {
    const pay = () =>
      api().post('/api/v1/payments').set(bearer(staffT)).send({ customerId: fx.custB.id, method: 'BANK_TRANSFER', amount: '10.00', paymentDate: D(TODAY), reference: 'SAME-REF', allocations: [{ invoiceId, amount: '10.00' }] });
    const results = await Promise.all([pay(), pay()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count({ where: { reference: 'SAME-REF' } })).toBe(1);
  });

  it('a payment cannot be allocated across customers', async () => {
    const res = await api().post('/api/v1/payments').set(bearer(staffT)).send({ customerId: fx.custA.id, method: 'CASH', amount: '5.00', paymentDate: D(TODAY), allocations: [{ invoiceId, amount: '5.00' }] });
    expect(res.status).toBe(422);
  });

  it('voiding restores the exact balance and cannot be repeated', async () => {
    const p = await prisma.payment.findFirstOrThrow({ where: { status: 'COMPLETED', reference: { startsWith: 'RACE-' } } });
    const before = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await api().post(`/api/v1/payments/${p.id}/void`).set(bearer(adminT)).send({ reason: 'test void' }).expect(200);
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(after.balanceDue.minus(before.balanceDue).toFixed(2)).toBe('600.00');
    expect((await api().post(`/api/v1/payments/${p.id}/void`).set(bearer(adminT)).send({ reason: 'again' })).status).toBe(422);
  });
});

describe('login brute-force protection', () => {
  it('blocks further attempts after 10 failures from the same client', async () => {
    process.env.RATE_LIMIT_TEST = 'on';
    try {
      const attempt = () => api().post('/api/v1/auth/login').send({ email: 'staff@test.local', password: 'Wrong@Pass1' });
      for (let i = 0; i < 10; i += 1) expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      // even the correct password is refused while limited
      expect((await api().post('/api/v1/auth/login').send({ email: 'staff@test.local', password: 'Test@Pass123' })).status).toBe(429);
    } finally {
      delete process.env.RATE_LIMIT_TEST;
    }
  });
});
