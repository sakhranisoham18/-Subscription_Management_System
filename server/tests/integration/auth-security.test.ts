import { beforeAll, describe, expect, it, afterAll } from 'vitest';
import { api, bearer, fixtures, login, prisma, activeSubscription, TODAY } from './helpers';
import { formatDateOnly } from '../../src/domain/dates';

let fx: Awaited<ReturnType<typeof fixtures>>;
let adminT: string, staffT: string, aT: string, bT: string;

beforeAll(async () => {
  fx = await fixtures();
  [adminT, staffT, aT, bT] = await Promise.all([login('admin@test.local'), login('staff@test.local'), login('custa@test.local'), login('custb@test.local')]);
});
afterAll(() => prisma.$disconnect());

describe('registration & authentication', () => {
  it('rejects weak passwords', async () => {
    const res = await api().post('/api/v1/auth/register').send({ name: 'Weak', email: 'weak@test.local', password: 'password' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.password).toBeDefined();
  });

  it('registers a customer and rejects the same email in a different case', async () => {
    const ok = await api().post('/api/v1/auth/register').send({ name: 'New Shop', email: 'New.Shop@Test.local', password: 'Str0ng!Pass' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.user.email).toBe('new.shop@test.local');
    expect(ok.body.data.user.role).toBe('CUSTOMER');
    expect(ok.headers['set-cookie']?.[0]).toMatch(/bl_refresh=.*HttpOnly/i);
    const dup = await api().post('/api/v1/auth/register').send({ name: 'Dup', email: 'NEW.SHOP@test.local', password: 'Str0ng!Pass' });
    expect(dup.status).toBe(409);
  });

  it('rejects wrong passwords with a generic message', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'admin@test.local', password: 'Wrong@Pass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Incorrect email or password');
  });

  it('password reset: generic response, single-use hashed token', async () => {
    const unknown = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody@test.local' });
    const known = await api().post('/api/v1/auth/forgot-password').send({ email: 'custa@test.local' });
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);

    const mail = await prisma.emailLog.findFirstOrThrow({ where: { to: 'custa@test.local' }, orderBy: { createdAt: 'desc' } });
    const token = /token=([^\s]+)/.exec(mail.body)![1];
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { usedAt: null } });
    expect(stored.tokenHash).not.toContain(decodeURIComponent(token)); // only the hash is stored

    const weak = await api().post('/api/v1/auth/reset-password').send({ token: decodeURIComponent(token), password: 'weak' });
    expect(weak.status).toBe(400);
    const ok = await api().post('/api/v1/auth/reset-password').send({ token: decodeURIComponent(token), password: 'Brand!New123' });
    expect(ok.status).toBe(200);
    const reuse = await api().post('/api/v1/auth/reset-password').send({ token: decodeURIComponent(token), password: 'Another!123x' });
    expect(reuse.status).toBe(400);
    await login('custa@test.local', 'Brand!New123');
  });

  it('rejects requests without or with a forged token', async () => {
    expect((await api().get('/api/v1/customers')).status).toBe(401);
    expect((await api().get('/api/v1/customers').set(bearer('forged.token.value'))).status).toBe(401);
  });
});

describe('role-based access control (Scenario G)', () => {
  it('staff cannot create staff accounts; admin can', async () => {
    const body = { name: 'Another', email: 'another@test.local', role: 'STAFF', password: 'Str0ng!Pass', sendInvite: false };
    expect((await api().post('/api/v1/users').set(bearer(staffT)).send(body)).status).toBe(403);
    expect((await api().get('/api/v1/users').set(bearer(staffT))).status).toBe(403);
    expect((await api().post('/api/v1/users').set(bearer(adminT)).send(body)).status).toBe(201);
  });

  it('only admin can create discount rules and products', async () => {
    const discount = { code: 'TEST10', name: 'Test', type: 'PERCENTAGE', value: '10', startsAt: formatDateOnly(TODAY), scope: 'ALL' };
    expect((await api().post('/api/v1/discounts').set(bearer(staffT)).send(discount)).status).toBe(403);
    expect((await api().post('/api/v1/discounts').set(bearer(adminT)).send(discount)).status).toBe(201);
    expect((await api().post('/api/v1/products').set(bearer(staffT)).send({ name: 'X', productType: 'Y', salesPrice: '1', costPrice: '1' })).status).toBe(403);
    expect((await api().get('/api/v1/discounts').set(bearer(staffT))).status).toBe(200);
  });

  it('customers cannot reach back-office endpoints', async () => {
    for (const path of ['/api/v1/customers', '/api/v1/invoices', '/api/v1/subscriptions', '/api/v1/reports/finance', '/api/v1/dashboard/summary']) {
      expect((await api().get(path).set(bearer(aT))).status).toBe(403);
    }
  });

  it('staff cannot void payments or view finance reports (admin only)', async () => {
    expect((await api().get('/api/v1/reports/finance').set(bearer(staffT))).status).toBe(403);
    expect((await api().get('/api/v1/reports/finance').set(bearer(adminT))).status).toBe(200);
  });

  it('deactivated users lose access immediately', async () => {
    const created = await prisma.user.findUniqueOrThrow({ where: { email: 'another@test.local' } });
    const t = await login('another@test.local', 'Str0ng!Pass');
    await api().patch(`/api/v1/users/${created.id}`).set(bearer(adminT)).send({ status: 'INACTIVE' }).expect(200);
    expect((await api().get('/api/v1/customers').set(bearer(t))).status).toBe(401);
  });
});

describe('customer data isolation (IDOR)', () => {
  let subB: string;
  let invB: string;
  beforeAll(async () => {
    subB = await activeSubscription(staffT, fx.custB.id, fx.plan.id, fx.product.id, fx.variant.id, formatDateOnly(TODAY));
    await api().post('/api/v1/billing/run').set(bearer(staffT)).send({}).expect(201);
    invB = (await prisma.invoice.findFirstOrThrow({ where: { subscriptionId: subB } })).id;
    await api().post(`/api/v1/invoices/${invB}/confirm`).set(bearer(staffT)).send({}).expect(200);
  });

  it("customer A cannot read customer B's subscription, invoice or PDF", async () => {
    expect((await api().get(`/api/v1/portal/subscriptions/${subB}`).set(bearer(aT))).status).toBe(404);
    expect((await api().get(`/api/v1/portal/invoices/${invB}`).set(bearer(aT))).status).toBe(404);
    expect((await api().get(`/api/v1/portal/invoices/${invB}/pdf`).set(bearer(aT))).status).toBe(404);
    expect((await api().post(`/api/v1/portal/subscriptions/${subB}/requests`).set(bearer(aT)).send({ type: 'CANCEL' })).status).toBe(404);
  });

  it('customer lists only contain their own records', async () => {
    const a = await api().get('/api/v1/portal/invoices').set(bearer(aT));
    expect(a.body.data).toHaveLength(0);
    const b = await api().get('/api/v1/portal/invoices').set(bearer(bT));
    expect(b.body.data.map((i: { id: string }) => i.id)).toContain(invB);
  });

  it('customer B can see and download their own invoice', async () => {
    expect((await api().get(`/api/v1/portal/invoices/${invB}`).set(bearer(bT))).status).toBe(200);
    const pdf = await api().get(`/api/v1/portal/invoices/${invB}/pdf`).set(bearer(bT));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('customers cannot mass-assign protected profile fields', async () => {
    const res = await api().patch('/api/v1/portal/profile').set(bearer(aT)).send({ email: 'hijack@test.local' });
    expect(res.status).toBe(400);
  });
});
