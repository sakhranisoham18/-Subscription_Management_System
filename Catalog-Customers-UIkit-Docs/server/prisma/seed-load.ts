/**
 * LOAD-TEST DATA. Adds thousands of fictional customers/subscriptions/invoices/payments on top of the demo seed
 * so the "pages respond in under 2 seconds with thousands of subscriptions" target can be measured.
 *
 *   npm run db:seed        # demo data first (provides plans, products, taxes, admin user)
 *   npm run db:seed:load   # then this (idempotent: removes previous load data first)
 *
 * Everything it creates is prefixed LD- / load*@loadtest.example, and is removed by re-running it.
 */
import { PrismaClient } from '@prisma/client';
import { formatDateOnly, todayIn } from '../src/domain/dates';

const prisma = new PrismaClient();
const N_CUSTOMERS = Number(process.env.LOAD_CUSTOMERS ?? 3000);
const N_SUBS = Number(process.env.LOAD_SUBSCRIPTIONS ?? 6000);

async function main() {
  const today = formatDateOnly(todayIn(process.env.APP_TIMEZONE || 'Asia/Kolkata'));
  const plan = await prisma.subscriptionPlan.findFirstOrThrow({ where: { name: 'Growth Monthly' } });
  const tax = await prisma.taxRule.findFirstOrThrow({ where: { isDefault: true } });
  const product = await prisma.product.findFirstOrThrow({ where: { name: 'Brightloop POS' }, include: { variants: true } });
  const variant = product.variants.find((v) => v.name === 'Odoo')!;
  const t0 = Date.now();

  await prisma.$transaction(
    async (tx) => {
      const run = (sql: string) => tx.$executeRawUnsafe(sql);

      // Deterministic, valid RFC-4122 v4-shaped UUIDs (the API validates ids strictly).
      await run(`CREATE OR REPLACE FUNCTION pg_temp.lduuid(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
        SELECT (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18, 3) || substr(h, 21, 12))::uuid::text FROM (SELECT md5(t) AS h) x $$`);

      // ── clean previous load data (children first) ──
      await run(`DELETE FROM "PaymentAllocation" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE number LIKE 'LD-INV-%')`);
      await run(`DELETE FROM "Payment" WHERE number LIKE 'LD-PAY-%'`);
      await run(`DELETE FROM "BillingEvent" WHERE "subscriptionId" IN (SELECT id FROM "Subscription" WHERE number LIKE 'LD-SUB-%')`);
      await run(`DELETE FROM "InvoiceLine" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "subscriptionId" IN (SELECT id FROM "Subscription" WHERE number LIKE 'LD-SUB-%'))`);
      await run(`DELETE FROM "DiscountUsage" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "subscriptionId" IN (SELECT id FROM "Subscription" WHERE number LIKE 'LD-SUB-%'))`);
      await run(`DELETE FROM "Invoice" WHERE "subscriptionId" IN (SELECT id FROM "Subscription" WHERE number LIKE 'LD-SUB-%')`);
      await run(`DELETE FROM "SubscriptionEvent" WHERE "subscriptionId" IN (SELECT id FROM "Subscription" WHERE number LIKE 'LD-SUB-%')`);
      await run(`DELETE FROM "SubscriptionLine" WHERE "subscriptionId" IN (SELECT id FROM "Subscription" WHERE number LIKE 'LD-SUB-%')`);
      await run(`DELETE FROM "Subscription" WHERE number LIKE 'LD-SUB-%'`);
      await run(`DELETE FROM "Customer" WHERE email LIKE 'load%@loadtest.example'`);
      await run(`DROP TABLE IF EXISTS _lp`);

      // ── customers ──
      await run(`
        INSERT INTO "Customer" (id, name, "companyName", email, phone, city, country, status, "createdAt", "updatedAt")
        SELECT pg_temp.lduuid('lc' || n), 'Load Contact ' || n, 'Load Company ' || n, 'load' || n || '@loadtest.example',
               '+91 90000 ' || lpad(n::text, 5, '0'), (ARRAY['Lucknow','Kanpur','Delhi','Mumbai','Pune'])[1 + n % 5], 'India', 'ACTIVE',
               now() - ((n % 360) || ' days')::interval, now()
        FROM generate_series(1, ${N_CUSTOMERS}) n`);

      // ── subscriptions: ~5% closed, ~5% paused, ~10% of active ones due for billing today ──
      await run(`
        INSERT INTO "Subscription" (id, number, "customerId", "planId", status, "startDate", "endDate", "billingFrequency", "billingInterval",
          "billingAnchorDay", "nextBillingDate", "paymentTermsDays", "autoRenew", "autoClose", currency, subtotal, "discountTotal", "taxTotal", total,
          "activatedAt", "createdAt", "updatedAt")
        SELECT pg_temp.lduuid('ls' || n), 'LD-SUB-' || lpad(n::text, 6, '0'), pg_temp.lduuid('lc' || (1 + n % ${N_CUSTOMERS})), '${plan.id}',
               st::"SubscriptionStatus", start_d, NULL, 'MONTHLY', 1, extract(day from start_d)::int,
               CASE WHEN st = 'CLOSED' THEN NULL WHEN due THEN '${today}'::date ELSE (start_d + ((m + 1) || ' months')::interval)::date END,
               15, false, false, 'INR', sub, 0, round(sub * 0.18, 2), round(sub * 1.18, 2), start_d, start_d, now()
        FROM (
          SELECT n, start_d, st, (st = 'ACTIVE' AND n % 10 = 2) AS due, m, 999 * ((n % 5) + 1) + 2560 * ((n % 3) + 1) AS sub
          FROM (
            SELECT n, ('${today}'::date - ((n * 7) % 330))::date AS start_d,
                   CASE WHEN n % 20 = 0 THEN 'CLOSED' WHEN n % 20 = 1 THEN 'PAUSED' ELSE 'ACTIVE' END AS st
            FROM generate_series(1, ${N_SUBS}) n
          ) a
          CROSS JOIN LATERAL (SELECT (extract(year from age('${today}'::date, a.start_d)) * 12 + extract(month from age('${today}'::date, a.start_d)))::int AS m) mm
        ) b`);

      await run(`
        INSERT INTO "SubscriptionLine" (id, "subscriptionId", "productId", "variantId", "isPlanFee", description, quantity, "unitPrice", "discountPercent",
          "taxRuleId", "taxRate", "lineSubtotal", "discountAmount", "taxAmount", "lineTotal", "sortOrder")
        SELECT pg_temp.lduuid('lsl' || s.id || k), s.id,
               CASE WHEN k = 1 THEN '${product.id}' END, CASE WHEN k = 1 THEN '${variant.id}' END, k = 0,
               CASE WHEN k = 0 THEN 'Growth Monthly — monthly plan' ELSE 'Brightloop POS (Brand: Odoo)' END,
               CASE WHEN k = 0 THEN (n % 5) + 1 ELSE (n % 3) + 1 END,
               CASE WHEN k = 0 THEN 999 ELSE 2560 END, 0, '${tax.id}', 18,
               CASE WHEN k = 0 THEN 999 * ((n % 5) + 1) ELSE 2560 * ((n % 3) + 1) END, 0,
               round(CASE WHEN k = 0 THEN 999 * ((n % 5) + 1) ELSE 2560 * ((n % 3) + 1) END * 0.18, 2),
               round(CASE WHEN k = 0 THEN 999 * ((n % 5) + 1) ELSE 2560 * ((n % 3) + 1) END * 1.18, 2), k
        FROM (SELECT id, substr(number, 8)::int AS n FROM "Subscription" WHERE number LIKE 'LD-SUB-%') s
        CROSS JOIN generate_series(0, 1) AS g(k)`);

      // ── billing periods → invoices (statuses: mostly paid, some open/overdue, recent drafts) ──
      await run(`
        CREATE TABLE _lp AS
        SELECT s.id AS sid, s."customerId" AS cid, s.number AS snum, substr(s.number, 8)::int AS n, k AS pk,
               (s."startDate" + (k || ' months')::interval)::date AS pstart, s.subtotal AS sub, row_number() OVER (ORDER BY s.number, k) AS rn
        FROM "Subscription" s
        CROSS JOIN LATERAL (SELECT (extract(year from age('${today}'::date, s."startDate")) * 12 + extract(month from age('${today}'::date, s."startDate")))::int AS m) mm
        CROSS JOIN LATERAL generate_series(0, CASE WHEN s.status = 'ACTIVE' THEN mm.m ELSE mm.m / 2 END) AS g(k)
        WHERE s.number LIKE 'LD-SUB-%'
          AND (s."startDate" + (k || ' months')::interval)::date <= '${today}'::date
          AND NOT (s.status = 'ACTIVE' AND s."nextBillingDate" = '${today}'::date AND (s."startDate" + (k || ' months')::interval)::date >= '${today}'::date)`);

      await run(`
        INSERT INTO "Invoice" (id, number, "customerId", "subscriptionId", source, status, "invoiceDate", "dueDate", "periodStart", "periodEnd", "billingPeriodKey",
          currency, subtotal, "discountTotal", "taxTotal", total, "amountPaid", "balanceDue", "billToName", "billToEmail", "confirmedAt", "createdAt", "updatedAt")
        SELECT pg_temp.lduuid('li' || p.sid || p.pstart), 'LD-INV-' || lpad(p.rn::text, 7, '0'), p.cid, p.sid, 'RECURRING', st::"InvoiceStatus",
               p.pstart, p.pstart + 15, p.pstart, ((p.pstart + interval '1 month')::date - 1), p.sid || ':' || p.pstart,
               'INR', p.sub, 0, round(p.sub * 0.18, 2), round(p.sub * 1.18, 2),
               CASE WHEN st = 'PAID' THEN round(p.sub * 1.18, 2) ELSE 0 END, CASE WHEN st = 'PAID' THEN 0 ELSE round(p.sub * 1.18, 2) END,
               c."companyName", c.email, CASE WHEN st <> 'DRAFT' THEN p.pstart END, p.pstart, now()
        FROM (
          SELECT *, CASE WHEN pstart > '${today}'::date - 20 THEN (CASE rn % 4 WHEN 0 THEN 'DRAFT' WHEN 1 THEN 'CONFIRMED' ELSE 'PAID' END)
                         WHEN rn % 25 = 0 THEN 'CONFIRMED' WHEN rn % 40 = 0 THEN 'PARTIALLY_PAID' ELSE 'PAID' END AS st
          FROM _lp
        ) p JOIN "Customer" c ON c.id = p.cid`);

      // partially paid invoices: pay 40 %
      await run(`UPDATE "Invoice" SET "amountPaid" = round(total * 0.4, 2), "balanceDue" = total - round(total * 0.4, 2) WHERE number LIKE 'LD-INV-%' AND status = 'PARTIALLY_PAID'`);

      await run(`
        INSERT INTO "InvoiceLine" (id, "invoiceId", "productId", "variantId", description, quantity, "unitPrice", "discountPercent", "taxRuleId", "taxRate",
          "lineSubtotal", "discountAmount", "taxAmount", "lineTotal", "sortOrder")
        SELECT pg_temp.lduuid('lil' || i.id || k), i.id, CASE WHEN k = 1 THEN '${product.id}' END, CASE WHEN k = 1 THEN '${variant.id}' END,
               CASE WHEN k = 0 THEN 'Growth Monthly — monthly plan' ELSE 'Brightloop POS (Brand: Odoo)' END,
               CASE WHEN k = 0 THEN (p.n % 5) + 1 ELSE (p.n % 3) + 1 END, CASE WHEN k = 0 THEN 999 ELSE 2560 END, 0, '${tax.id}', 18,
               CASE WHEN k = 0 THEN 999 * ((p.n % 5) + 1) ELSE 2560 * ((p.n % 3) + 1) END, 0,
               round(CASE WHEN k = 0 THEN 999 * ((p.n % 5) + 1) ELSE 2560 * ((p.n % 3) + 1) END * 0.18, 2),
               round(CASE WHEN k = 0 THEN 999 * ((p.n % 5) + 1) ELSE 2560 * ((p.n % 3) + 1) END * 1.18, 2), k
        FROM "Invoice" i JOIN _lp p ON i.id = pg_temp.lduuid('li' || p.sid || p.pstart)
        CROSS JOIN generate_series(0, 1) AS g(k) WHERE i.number LIKE 'LD-INV-%'`);

      // ── payments for paid and partially paid invoices ──
      await run(`
        INSERT INTO "Payment" (id, number, "customerId", method, amount, "paymentDate", reference, status, "createdAt", "updatedAt")
        SELECT pg_temp.lduuid('lp' || i.id), 'LD-PAY-' || substr(i.number, 8), i."customerId",
               (ARRAY['BANK_TRANSFER','UPI','UPI','CARD','CHEQUE','CASH'])[1 + (row_number() OVER (ORDER BY i.number)) % 6]::"PaymentMethod",
               i."amountPaid", LEAST(i."invoiceDate" + 3, '${today}'::date), 'LDREF-' || substr(i.number, 8), 'COMPLETED', i."invoiceDate", now()
        FROM "Invoice" i WHERE i.number LIKE 'LD-INV-%' AND i."amountPaid" > 0`);
      await run(`
        INSERT INTO "PaymentAllocation" (id, "paymentId", "invoiceId", amount, "createdAt")
        SELECT pg_temp.lduuid('la' || i.id), pg_temp.lduuid('lp' || i.id), i.id, i."amountPaid", i."invoiceDate"
        FROM "Invoice" i WHERE i.number LIKE 'LD-INV-%' AND i."amountPaid" > 0`);
      await run(`DROP TABLE _lp`);
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  await prisma.$executeRawUnsafe('ANALYZE');
  const [subs, invs, pays, due] = await Promise.all([
    prisma.subscription.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.subscription.count({ where: { status: 'ACTIVE', nextBillingDate: { lte: new Date(`${today}T00:00:00Z`) } } }),
  ]);
  console.log(`✔ Load data ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${subs} subscriptions (${due} due for billing today), ${invs} invoices, ${pays} payments.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
