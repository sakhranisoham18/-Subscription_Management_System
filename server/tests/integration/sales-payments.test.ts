import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, fixtures, login, prisma, TODAY, addDays } from './helpers';
import { formatDateOnly } from '../../src/domain/dates';
import { runBilling } from '../../src/services/billing';

let fx: Awaited<ReturnType<typeof fixtures>>;
let staffT: string, adminT: string, aT: string, bT: string;

beforeAll(async () => {
  fx = await fixtures();
  [staffT, adminT, aT, bT] = await Promise.all([login('staff@test.local'), login('admin@test.local'), login('custa@test.local'), login('custb@test.local')]);
});
afterAll(() => prisma.$disconnect());

describe('quotation → subscription (Scenarios B & C)', () => {
  let quotationId: string;
  let subscriptionId: string;

  it('prices on the server, applies an eligible discount and ignores client-sent prices', async () => {
    await prisma.discount.create({
      data: { code: 'SEATS10', name: '10% for 5+', type: 'PERCENTAGE', value: '10', minQuantity: 5, startsAt: addDays(TODAY, -10), scope: 'ALL', autoApply: false },
    });
    const discount = await prisma.discount.findUniqueOrThrow({ where: { code: 'SEATS10' } });
    const res = await api()
      .post('/api/v1/quotations')
      .set(bearer(staffT))
      .send({
        customerId: fx.custA.id,
        planId: fx.plan.id,
        validityDays: 15,
        discountId: discount.id,
        lines: [{ type: 'PRODUCT', productId: fx.product.id, variantId: fx.variant.id, quantity: 5, unitPrice: '1', total: '1' }],
      });
    expect(res.status).toBe(201);
    quotationId = res.body.data.id;
    expect(res.body.data.subtotal).toBe('12800');
    expect(res.body.data.discountTotal).toBe('1280');
    expect(res.body.data.taxTotal).toBe('2073.6');
    expect(res.body.data.total).toBe('13593.6');
  });

  it('rejects an ineligible discount', async () => {
    const discount = await prisma.discount.findUniqueOrThrow({ where: { code: 'SEATS10' } });
    const res = await api()
      .post('/api/v1/quotations/preview')
      .set(bearer(staffT))
      .send({ planId: fx.plan.id, discountId: discount.id, lines: [{ type: 'PLAN', quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Minimum quantity/);
  });

  it('generates a PDF and sends it via the email abstraction', async () => {
    const pdf = await api().get(`/api/v1/quotations/${quotationId}/pdf`).set(bearer(staffT));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await api().post(`/api/v1/quotations/${quotationId}/send`).set(bearer(staffT)).expect(200);
    const mail = await prisma.emailLog.findFirst({ where: { to: fx.custA.email, subject: { contains: 'Quotation' } } });
    expect(mail?.body).toMatch(/\.pdf/);
  });

  it('customer B cannot accept customer A’s quotation; customer A can', async () => {
    expect((await api().post(`/api/v1/portal/quotations/${quotationId}/accept`).set(bearer(bT))).status).toBe(404);
    expect((await api().post(`/api/v1/portal/quotations/${quotationId}/accept`).set(bearer(aT))).status).toBe(200);
  });

  it('converts into a confirmed subscription without losing lines, prices or taxes', async () => {
    const res = await api().post(`/api/v1/quotations/${quotationId}/convert`).set(bearer(staffT)).send({});
    expect(res.status).toBe(201);
    subscriptionId = res.body.data.id;
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { lines: true } });
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lines: true } });
    expect(sub.status).toBe('CONFIRMED');
    expect(sub.customerId).toBe(q.customerId);
    expect(sub.total.toFixed(2)).toBe(q.total.toFixed(2));
    expect(sub.lines).toHaveLength(q.lines.length);
    expect(sub.lines[0].taxRate.toFixed(2)).toBe(q.lines[0].taxRate.toFixed(2));
    expect(q.status).toBe('CONVERTED');
    // converting twice is impossible
    expect((await api().post(`/api/v1/quotations/${quotationId}/convert`).set(bearer(staffT)).send({})).status).toBe(422);
  });

  it('enforces the lifecycle (cannot pause a confirmed subscription) and activates', async () => {
    expect((await api().post(`/api/v1/subscriptions/${subscriptionId}/pause`).set(bearer(staffT)).send({})).status).toBe(422);
    await api().post(`/api/v1/subscriptions/${subscriptionId}/activate`).set(bearer(staffT)).expect(200);
    const portal = await api().get('/api/v1/portal/subscriptions').set(bearer(aT));
    expect(portal.body.data.map((s: { id: string }) => s.id)).toContain(subscriptionId);
    const other = await api().get('/api/v1/portal/subscriptions').set(bearer(bT));
    expect(other.body.data.map((s: { id: string }) => s.id)).not.toContain(subscriptionId);
  });

  it('rejects archived products for new sales', async () => {
    await prisma.product.update({ where: { id: fx.product.id }, data: { status: 'ARCHIVED' } });
    const res = await api().post('/api/v1/quotations/preview').set(bearer(staffT)).send({ planId: fx.plan.id, lines: [{ type: 'PRODUCT', productId: fx.product.id, quantity: 1 }] });
    expect(res.status).toBe(422);
    await prisma.product.update({ where: { id: fx.product.id }, data: { status: 'ACTIVE' } });
  });
});

describe('payments and overdue tracking (Scenario E)', () => {
  let invoiceId: string;
  let total: string;

  beforeAll(async () => {
    await runBilling({ trigger: 'MANUAL' });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { customerId: fx.custA.id, status: 'DRAFT' } });
    invoiceId = inv.id;
    total = inv.total.toFixed(2);
  });

  it('cannot pay a draft invoice', async () => {
    const res = await api()
      .post('/api/v1/payments')
      .set(bearer(staffT))
      .send({ customerId: fx.custA.id, method: 'UPI', amount: '100', paymentDate: formatDateOnly(TODAY), allocations: [{ invoiceId, amount: '100' }] });
    expect(res.status).toBe(422);
  });

  it('partial payment → Partially paid with correct balance; remainder → Paid', async () => {
    await api().post(`/api/v1/invoices/${invoiceId}/confirm`).set(bearer(staffT)).send({}).expect(200);
    const first = await api()
      .post('/api/v1/payments')
      .set(bearer(staffT))
      .send({ customerId: fx.custA.id, method: 'BANK_TRANSFER', amount: '5000.00', paymentDate: formatDateOnly(TODAY), reference: 'UTR-1', allocations: [{ invoiceId, amount: '5000.00' }] });
    expect(first.status).toBe(201);
    let inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe('PARTIALLY_PAID');
    expect(inv.balanceDue.toFixed(2)).toBe((Number(total) - 5000).toFixed(2));

    const over = await api()
      .post('/api/v1/payments')
      .set(bearer(staffT))
      .send({ customerId: fx.custA.id, method: 'CASH', amount: total, paymentDate: formatDateOnly(TODAY), allocations: [{ invoiceId, amount: total }] });
    expect(over.status).toBe(422);

    const dupRef = await api()
      .post('/api/v1/payments')
      .set(bearer(staffT))
      .send({ customerId: fx.custA.id, method: 'BANK_TRANSFER', amount: '1.00', paymentDate: formatDateOnly(TODAY), reference: 'UTR-1', allocations: [{ invoiceId, amount: '1.00' }] });
    expect(dupRef.status).toBe(409);

    const remaining = inv.balanceDue.toFixed(2);
    await api()
      .post('/api/v1/payments')
      .set(bearer(staffT))
      .send({ customerId: fx.custA.id, method: 'CARD', amount: remaining, paymentDate: formatDateOnly(TODAY), allocations: [{ invoiceId, amount: remaining }] })
      .expect(201);
    inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe('PAID');
    expect(inv.balanceDue.toFixed(2)).toBe('0.00');
  });

  it('voiding a payment (admin only) restores the balance with an audit trail', async () => {
    const pay = await prisma.payment.findFirstOrThrow({ where: { method: 'CARD' } });
    expect((await api().post(`/api/v1/payments/${pay.id}/void`).set(bearer(staffT)).send({ reason: 'Card chargeback' })).status).toBe(403);
    await api().post(`/api/v1/payments/${pay.id}/void`).set(bearer(adminT)).send({ reason: 'Card chargeback' }).expect(200);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe('PARTIALLY_PAID');
    expect(await prisma.auditLog.count({ where: { action: 'PAYMENT_VOIDED', entityId: pay.id } })).toBe(1);
  });

  it('an unpaid invoice past its due date is reported as overdue', async () => {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { dueDate: addDays(TODAY, -3) } });
    const list = await api().get('/api/v1/invoices?status=OVERDUE').set(bearer(staffT));
    expect(list.body.data.map((i: { id: string }) => i.id)).toContain(invoiceId);
    expect(list.body.data.find((i: { id: string }) => i.id === invoiceId).displayStatus).toBe('OVERDUE');
    const report = await api().get('/api/v1/reports/finance').set(bearer(adminT));
    expect(report.body.data.overdueCount).toBeGreaterThanOrEqual(1);
    const dash = await api().get('/api/v1/dashboard/summary').set(bearer(staffT));
    expect(dash.body.data.overdueCount).toBeGreaterThanOrEqual(1);
  });

  it('cannot cancel an invoice with payments recorded', async () => {
    expect((await api().post(`/api/v1/invoices/${invoiceId}/cancel`).set(bearer(staffT)).send({ reason: 'mistake' })).status).toBe(422);
  });
});

describe('finance report exports (Scenario F)', () => {
  it('exports CSV and PDF for a date range', async () => {
    const q = `from=${formatDateOnly(addDays(TODAY, -30))}&to=${formatDateOnly(TODAY)}`;
    const report = await api().get(`/api/v1/reports/finance?${q}`).set(bearer(adminT));
    expect(report.status).toBe(200);
    expect(Number(report.body.data.collected.amount)).toBeGreaterThan(0);
    const csv = await api().get(`/api/v1/reports/finance/export.csv?${q}&kind=invoices`).set(bearer(adminT));
    expect(csv.status).toBe(200);
    expect(csv.text).toMatch(/Invoice,Invoice date/);
    const pdf = await api().get(`/api/v1/reports/finance/export.pdf?${q}`).set(bearer(adminT));
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
});
