import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, fixtures, login, prisma } from './helpers';
import { env } from '../../src/config/env';

/** Mail server unreachable: nothing may leak (no account enumeration) and no document may be wrongly marked as sent. */
let fx: Awaited<ReturnType<typeof fixtures>>;
let staffT: string;
let adminT: string;

beforeAll(async () => {
  fx = await fixtures();
  [staffT, adminT] = await Promise.all([login('staff@test.local'), login('admin@test.local')]);
  env.SMTP_HOST = '127.0.0.1';
  env.SMTP_PORT = 1; // nothing listens here → connection refused
});
afterAll(async () => {
  env.SMTP_HOST = '';
  await prisma.$disconnect();
});

describe('mail server unreachable', () => {
  it('forgot-password responds identically for existing and unknown emails (no enumeration)', async () => {
    const known = await api().post('/api/v1/auth/forgot-password').send({ email: 'custa@test.local' });
    const unknown = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody@test.local' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(await prisma.emailLog.count({ where: { status: 'FAILED', to: 'custa@test.local' } })).toBeGreaterThan(0);
  });

  it('sending an invoice returns a clear 502 and does not mark it as sent', async () => {
    const created = await api().post('/api/v1/invoices').set(bearer(staffT)).send({ customerId: fx.custA.id, lines: [{ type: 'PRODUCT', productId: fx.product.id, quantity: 1 }] });
    const id = created.body.data.id;
    const confirm = await api().post(`/api/v1/invoices/${id}/confirm`).set(bearer(staffT)).send({ sendEmail: false });
    expect(confirm.status).toBe(200);
    const res = await api().post(`/api/v1/invoices/${id}/send`).set(bearer(staffT));
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('EMAIL_FAILED');
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).sentAt).toBeNull();
  });

  it('confirming with "email the customer" still confirms the invoice and warns', async () => {
    const created = await api().post('/api/v1/invoices').set(bearer(staffT)).send({ customerId: fx.custA.id, lines: [{ type: 'PRODUCT', productId: fx.product.id, quantity: 1 }] });
    const id = created.body.data.id;
    const res = await api().post(`/api/v1/invoices/${id}/confirm`).set(bearer(staffT)).send({ sendEmail: true });
    expect(res.status).toBe(200);
    expect(res.body.emailWarning).toMatch(/could not be sent/);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.status).toBe('CONFIRMED');
    expect(inv.sentAt).toBeNull();
  });

  it('a quotation that could not be emailed stays a draft', async () => {
    const created = await api()
      .post('/api/v1/quotations')
      .set(bearer(staffT))
      .send({ customerId: fx.custA.id, planId: fx.plan.id, lines: [{ type: 'PLAN', quantity: 1 }] });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const res = await api().post(`/api/v1/quotations/${id}/send`).set(bearer(staffT));
    expect(res.status).toBe(502);
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id } });
    expect(q.status).toBe('DRAFT');
    expect(q.sentAt).toBeNull();
  });

  it('creating staff with an invitation keeps the account and reports the email problem', async () => {
    const res = await api().post('/api/v1/users').set(bearer(adminT)).send({ name: 'Invited Person', email: 'invited@test.local', role: 'STAFF', sendInvite: true });
    expect(res.status).toBe(201);
    expect(res.body.warning).toMatch(/invitation email could not be sent/);
    expect(await prisma.user.count({ where: { email: 'invited@test.local' } })).toBe(1);
  });
});
