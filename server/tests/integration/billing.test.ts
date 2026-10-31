import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, fixtures, login, prisma, activeSubscription, TODAY, addDays } from './helpers';
import { runBilling } from '../../src/services/billing';
import { addBillingPeriods, formatDateOnly } from '../../src/domain/dates';

let fx: Awaited<ReturnType<typeof fixtures>>;
let staffT: string;
let adminT: string;

beforeAll(async () => {
  fx = await fixtures();
  [staffT, adminT] = await Promise.all([login('staff@test.local'), login('admin@test.local')]);
});
afterAll(() => prisma.$disconnect());

describe('recurring invoice generation (Scenario D)', () => {
  let subId: string;

  it('previews, generates an invoice with full details and advances the next billing date', async () => {
    subId = await activeSubscription(staffT, fx.custA.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY), 2);
    const preview = await api().get('/api/v1/billing/preview').set(bearer(staffT));
    expect(preview.body.data.items.map((i: { id: string }) => i.id)).toContain(subId);

    const run = await api().post('/api/v1/billing/run').set(bearer(staffT)).send({});
    expect(run.status).toBe(201);
    expect(run.body.data.invoicesCreated).toBe(1);

    const invoices = await prisma.invoice.findMany({ where: { subscriptionId: subId }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    // 2 × 1000 (plan) + 2 × 2560 (POS Odoo) = 7120; +18% = 8401.60
    expect(inv.subtotal.toFixed(2)).toBe('7120.00');
    expect(inv.taxTotal.toFixed(2)).toBe('1281.60');
    expect(inv.total.toFixed(2)).toBe('8401.60');
    expect(inv.balanceDue.toFixed(2)).toBe('8401.60');
    expect(inv.status).toBe('DRAFT'); // generated ≠ paid
    expect(inv.lines).toHaveLength(2);
    expect(inv.billToEmail).toBe(fx.custA.email);
    expect(formatDateOnly(inv.periodStart!)).toBe(formatDateOnly(TODAY));

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(formatDateOnly(sub.nextBillingDate!)).toBe(formatDateOnly(addBillingPeriods(TODAY, 'MONTHLY')));
  });

  it('running billing again does not create a duplicate invoice', async () => {
    const run = await runBilling({ trigger: 'MANUAL' });
    expect(run.invoicesCreated).toBe(0);
    expect(await prisma.invoice.count({ where: { subscriptionId: subId } })).toBe(1);
  });

  it('resetting the schedule to an already-billed period never re-bills it (idempotency key)', async () => {
    await api().patch(`/api/v1/subscriptions/${subId}/next-billing-date`).set(bearer(staffT)).send({ nextBillingDate: formatDateOnly(TODAY) }).expect(200);
    const run = await runBilling({ trigger: 'MANUAL' });
    expect(run.invoicesCreated).toBe(0);
    expect(run.skipped).toBe(1);
    expect(await prisma.invoice.count({ where: { subscriptionId: subId } })).toBe(1);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
    expect(sub.nextBillingDate! > TODAY).toBe(true);
  });

  it('concurrent runs cannot double-bill', async () => {
    const s = await activeSubscription(staffT, fx.custA.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY));
    const results = await Promise.allSettled([runBilling({ trigger: 'MANUAL' }), runBilling({ trigger: 'MANUAL' }), runBilling({ trigger: 'SCHEDULED' })]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.invoice.count({ where: { subscriptionId: s } })).toBe(1);
  });

  it('bills every missed period in order (catch-up, nothing skipped)', async () => {
    const start = addDays(TODAY, -95);
    const s = await activeSubscription(staffT, fx.custB.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(start));
    await runBilling({ trigger: 'MANUAL' });
    const invs = await prisma.invoice.findMany({ where: { subscriptionId: s }, orderBy: { periodStart: 'asc' } });
    let expected = start;
    const expectedDates: string[] = [];
    while (expected <= TODAY) {
      expectedDates.push(formatDateOnly(expected));
      expected = addBillingPeriods(expected, 'MONTHLY', 1, start.getUTCDate());
    }
    expect(invs.map((i) => formatDateOnly(i.periodStart!))).toEqual(expectedDates);
  });

  it('paused and closed subscriptions are not billed', async () => {
    const paused = await activeSubscription(staffT, fx.custA.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY));
    await api().post(`/api/v1/subscriptions/${paused}/pause`).set(bearer(staffT)).send({}).expect(200);
    const closed = await activeSubscription(staffT, fx.custA.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY));
    await api().post(`/api/v1/subscriptions/${closed}/close`).set(bearer(staffT)).send({ reason: 'test' }).expect(200);
    await runBilling({ trigger: 'MANUAL' });
    expect(await prisma.invoice.count({ where: { subscriptionId: { in: [paused, closed] } } })).toBe(0);
  });

  it('does not bill beyond the subscription end date', async () => {
    const s = await activeSubscription(staffT, fx.custA.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(addDays(TODAY, -40)));
    await prisma.subscription.update({ where: { id: s }, data: { endDate: addDays(TODAY, -20), autoClose: false } });
    await runBilling({ trigger: 'MANUAL' });
    expect(await prisma.invoice.count({ where: { subscriptionId: s } })).toBe(1);
  });

  it('a failure on one subscription does not block others and does not advance its date', async () => {
    const good = await activeSubscription(staffT, fx.custA.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY));
    const bad = await activeSubscription(staffT, fx.custB.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY));
    await prisma.subscriptionLine.deleteMany({ where: { subscriptionId: bad } }); // force a failure (no lines)
    const run = await runBilling({ trigger: 'MANUAL' });
    expect(run.failures).toBe(1);
    expect(run.status).toBe('PARTIAL');
    expect(await prisma.invoice.count({ where: { subscriptionId: good } })).toBe(1);
    const badSub = await prisma.subscription.findUniqueOrThrow({ where: { id: bad } });
    expect(formatDateOnly(badSub.nextBillingDate!)).toBe(formatDateOnly(TODAY));
    const failed = await prisma.billingEvent.findFirst({ where: { runId: run.id, subscriptionId: bad, status: 'FAILED' } });
    expect(failed).not.toBeNull();
  });

  it('only authorised roles may run billing', async () => {
    const cT = await login('custa@test.local');
    expect((await api().post('/api/v1/billing/run').set(bearer(cT)).send({})).status).toBe(403);
    expect((await api().post('/api/v1/billing/run').set(bearer(adminT)).send({ asOf: formatDateOnly(addDays(TODAY, 5)) })).status).toBe(422);
  });
});

describe('batching (regression: no due subscription may be skipped at batch boundaries)', () => {
  it('bills every due subscription when there are many more than one batch', async () => {
    await prisma.subscription.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'CLOSED', nextBillingDate: null } });
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1) ids.push(await activeSubscription(staffT, i % 2 ? fx.custA.id : fx.custB.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY)));
    const run = await runBilling({ trigger: 'MANUAL', batchSize: 3 }); // 4 batches: 3 + 3 + 3 + 2
    expect(run.subscriptionsProcessed).toBe(11);
    expect(run.invoicesCreated).toBe(11);
    expect(await prisma.invoice.count({ where: { subscriptionId: { in: ids } } })).toBe(11);
    const again = await runBilling({ trigger: 'MANUAL', batchSize: 3 });
    expect(again.invoicesCreated).toBe(0);
  });
});

describe('automatic discounts on invoices', () => {
  it('applies an eligible discount automatically and stops at the usage cap', async () => {
    await prisma.subscription.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'CLOSED', nextBillingDate: null } });
    const discount = await prisma.discount.create({
      data: { code: 'CAP2', name: 'Capped', type: 'PERCENTAGE', value: '10', startsAt: addDays(TODAY, -30), usageLimit: 2, scope: 'ALL', autoApply: true },
    });
    const subs = [];
    for (let i = 0; i < 3; i += 1) subs.push(await activeSubscription(staffT, fx.custA.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY)));
    await runBilling({ trigger: 'MANUAL' });
    const invs = await prisma.invoice.findMany({ where: { subscriptionId: { in: subs } } });
    expect(invs).toHaveLength(3);
    expect(invs.filter((i) => i.discountId === discount.id)).toHaveLength(2);
    const withDiscount = invs.find((i) => i.discountId === discount.id)!;
    expect(withDiscount.discountTotal.toFixed(2)).toBe('356.00'); // 10% of 3560
    const updated = await prisma.discount.findUniqueOrThrow({ where: { id: discount.id } });
    expect(updated.usedCount).toBe(2);
    expect(await prisma.discountUsage.count({ where: { discountId: discount.id } })).toBe(2);
  });

  it('expired discounts are not applied', async () => {
    await prisma.discount.updateMany({ data: { status: 'ARCHIVED' } });
    await prisma.discount.create({
      data: { code: 'OLD', name: 'Expired', type: 'FIXED', value: '100', startsAt: addDays(TODAY, -60), endsAt: addDays(TODAY, -1), scope: 'ALL', autoApply: true },
    });
    const s = await activeSubscription(staffT, fx.custB.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY));
    await runBilling({ trigger: 'MANUAL' });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { subscriptionId: s } });
    expect(inv.discountId).toBeNull();
    expect(inv.discountTotal.toFixed(2)).toBe('0.00');
  });
});
