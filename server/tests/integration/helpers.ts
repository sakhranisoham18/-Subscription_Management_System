import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { invalidateSettingsCache } from '../../src/lib/settings';
import { todayIn, addDays } from '../../src/domain/dates';

export const app = createApp();
export const api = () => request(app);
export const TODAY = todayIn('Asia/Kolkata');
export { addDays, prisma };

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  invalidateSettingsCache();
}

export const PASSWORD = 'Test@Pass123';

export async function fixtures() {
  await resetDb();
  const passwordHash = bcrypt.hashSync(PASSWORD, 4);
  const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin@test.local', role: 'ADMIN', passwordHash } });
  const staff = await prisma.user.create({ data: { name: 'Staff', email: 'staff@test.local', role: 'STAFF', passwordHash } });
  const mkCustomer = async (n: string) => {
    const user = await prisma.user.create({ data: { name: `Customer ${n}`, email: `cust${n}@test.local`, role: 'CUSTOMER', passwordHash } });
    return prisma.customer.create({ data: { name: `Customer ${n}`, companyName: `Company ${n}`, email: user.email, userId: user.id } });
  };
  const custA = await mkCustomer('a');
  const custB = await mkCustomer('b');
  const tax = await prisma.taxRule.create({ data: { name: 'GST 18%', rate: '18', isDefault: true } });
  const product = await prisma.product.create({
    data: {
      name: 'POS',
      productType: 'Software',
      salesPrice: '2000',
      costPrice: '500',
      taxRuleId: tax.id,
      variants: { create: [{ attribute: 'Brand', name: 'Odoo', priceAdjustment: '560' }] },
    },
    include: { variants: true },
  });
  const plan = await prisma.subscriptionPlan.create({
    data: { name: 'Monthly', billingFrequency: 'MONTHLY', price: '1000', minQuantity: 1, availableFrom: addDays(TODAY, -400), taxRuleId: tax.id },
  });
  return { admin, staff, custA, custB, tax, product, variant: product.variants[0], plan };
}

export async function login(email: string, password = PASSWORD) {
  const res = await api().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Creates an ACTIVE subscription directly via the API (create → confirm → activate). */
export async function activeSubscription(token: string, customerId: string, planId: string, productId: string, variantId: string, startDate: string, qty = 1) {
  const created = await api()
    .post('/api/v1/subscriptions')
    .set(bearer(token))
    .send({
      customerId,
      planId,
      startDate,
      lines: [
        { type: 'PLAN', quantity: qty },
        { type: 'PRODUCT', productId, variantId, quantity: qty },
      ],
    });
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  const id = created.body.data.id as string;
  await api().post(`/api/v1/subscriptions/${id}/confirm`).set(bearer(token)).expect(200);
  await api().post(`/api/v1/subscriptions/${id}/activate`).set(bearer(token)).expect(200);
  return id;
}
