import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { d, sum, toMoneyString } from '../domain/money';
import { addDays, formatDateOnly, monthlyFactor, type Frequency } from '../domain/dates';

export interface ReportFilters {
  from: Date;
  to: Date;
  billingFrequency?: Frequency;
  customerId?: string;
  planId?: string;
  invoiceStatus?: 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
  paymentMethod?: 'BANK_TRANSFER' | 'CARD' | 'CASH' | 'UPI' | 'CHEQUE' | 'OTHER';
}

export const REPORT_DEFINITIONS = [
  'Invoiced revenue = totals (incl. tax) of Confirmed, Partially paid and Paid invoices dated in the period. Draft and Cancelled invoices are excluded.',
  'Collected revenue = completed (non-voided) payments dated in the period.',
  'Outstanding = unpaid balance of open (Confirmed / Partially paid) invoices as of today.',
  'Overdue = outstanding balance of open invoices whose due date is before today.',
  'MRR (monthly recurring revenue) = recurring net amount (after line discounts, before tax) of Active subscriptions, normalised to a month: daily × 365/12, weekly × 52/12, monthly × 1, yearly ÷ 12 (divided by the billing interval). ARR = MRR × 12.',
  'Discounts given = line and document discounts on invoices counted in invoiced revenue.',
];

const REVENUE_STATUSES = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] as const;

/** MRR from Active subscriptions (aggregated in the database; normalised in decimal arithmetic). */
export async function recurringRevenue(where: Prisma.SubscriptionWhereInput = {}) {
  const groups = await prisma.subscription.groupBy({
    by: ['billingFrequency', 'billingInterval'],
    where: { ...where, status: 'ACTIVE' },
    _sum: { subtotal: true, discountTotal: true },
    _count: true,
  });
  const mrr = sum(
    groups.map((g) => {
      const [num, den] = monthlyFactor(g.billingFrequency as Frequency, g.billingInterval);
      return d(g._sum.subtotal).minus(d(g._sum.discountTotal)).mul(num).div(den);
    }),
  );
  return {
    mrr: toMoneyString(mrr),
    arr: toMoneyString(mrr.mul(12)),
    byFrequency: groups.reduce<Record<string, { count: number; mrr: string }>>((acc, g) => {
      const [num, den] = monthlyFactor(g.billingFrequency as Frequency, g.billingInterval);
      const value = d(g._sum.subtotal).minus(d(g._sum.discountTotal)).mul(num).div(den);
      const prev = acc[g.billingFrequency];
      acc[g.billingFrequency] = {
        count: (prev?.count ?? 0) + g._count,
        mrr: toMoneyString(d(prev?.mrr ?? 0).plus(value)),
      };
      return acc;
    }, {}),
  };
}

function subscriptionWhere(f: Partial<ReportFilters>): Prisma.SubscriptionWhereInput {
  return { billingFrequency: f.billingFrequency, customerId: f.customerId, planId: f.planId };
}

function invoiceScope(f: Partial<ReportFilters>): Prisma.InvoiceWhereInput {
  return {
    customerId: f.customerId,
    ...(f.planId || f.billingFrequency
      ? { subscription: { planId: f.planId, billingFrequency: f.billingFrequency } }
      : {}),
  };
}

/** Month buckets of invoiced vs collected (SQL GROUP BY date_trunc; filters bound as parameters). */
export async function revenueSeries(f: ReportFilters) {
  const invConds: Prisma.Sql[] = [
    Prisma.sql`i."status" IN ('CONFIRMED','PARTIALLY_PAID','PAID')`,
    Prisma.sql`i."invoiceDate" BETWEEN ${f.from} AND ${f.to}`,
  ];
  if (f.customerId) invConds.push(Prisma.sql`i."customerId" = ${f.customerId}`);
  if (f.invoiceStatus) invConds.push(Prisma.sql`i."status"::text = ${f.invoiceStatus}`);
  if (f.planId) invConds.push(Prisma.sql`s."planId" = ${f.planId}`);
  if (f.billingFrequency) invConds.push(Prisma.sql`s."billingFrequency"::text = ${f.billingFrequency}`);

  const payConds: Prisma.Sql[] = [Prisma.sql`p."status" = 'COMPLETED'`, Prisma.sql`p."paymentDate" BETWEEN ${f.from} AND ${f.to}`];
  if (f.customerId) payConds.push(Prisma.sql`p."customerId" = ${f.customerId}`);
  if (f.paymentMethod) payConds.push(Prisma.sql`p."method"::text = ${f.paymentMethod}`);

  const [invoiced, collected] = await Promise.all([
    prisma.$queryRaw<{ month: Date; amount: Prisma.Decimal; count: bigint }[]>`
      SELECT date_trunc('month', i."invoiceDate")::date AS month, SUM(i."total") AS amount, COUNT(*) AS count
      FROM "Invoice" i LEFT JOIN "Subscription" s ON s."id" = i."subscriptionId"
      WHERE ${Prisma.join(invConds, ' AND ')}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ month: Date; amount: Prisma.Decimal }[]>`
      SELECT date_trunc('month', p."paymentDate")::date AS month, SUM(p."amount") AS amount
      FROM "Payment" p
      WHERE ${Prisma.join(payConds, ' AND ')}
      GROUP BY 1 ORDER BY 1`,
  ]);

  // continuous month axis
  const months: string[] = [];
  const cursor = new Date(Date.UTC(f.from.getUTCFullYear(), f.from.getUTCMonth(), 1));
  while (cursor <= f.to && months.length < 60) {
    months.push(formatDateOnly(cursor).slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const inv = new Map(invoiced.map((r) => [formatDateOnly(new Date(r.month)).slice(0, 7), r]));
  const col = new Map(collected.map((r) => [formatDateOnly(new Date(r.month)).slice(0, 7), r]));
  return months.map((m) => ({
    month: m,
    invoiced: toMoneyString(inv.get(m)?.amount ?? 0),
    collected: toMoneyString(col.get(m)?.amount ?? 0),
    invoiceCount: Number(inv.get(m)?.count ?? 0),
  }));
}

export async function receivables(today: Date, scope: Prisma.InvoiceWhereInput = {}) {
  const open: Prisma.InvoiceWhereInput = { ...scope, status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, balanceDue: { gt: 0 } };
  const [outstanding, overdue] = await Promise.all([
    prisma.invoice.aggregate({ where: open, _sum: { balanceDue: true }, _count: true }),
    prisma.invoice.aggregate({ where: { ...open, dueDate: { lt: today } }, _sum: { balanceDue: true }, _count: true }),
  ]);
  return {
    outstanding: toMoneyString(outstanding._sum.balanceDue ?? 0),
    outstandingCount: outstanding._count,
    overdue: toMoneyString(overdue._sum.balanceDue ?? 0),
    overdueCount: overdue._count,
  };
}

/** Ageing buckets of overdue receivables. */
export async function ageing(today: Date, scope: Prisma.InvoiceWhereInput = {}) {
  const buckets = [
    { label: '1–30 days', from: 1, to: 30 },
    { label: '31–60 days', from: 31, to: 60 },
    { label: '61–90 days', from: 61, to: 90 },
    { label: '90+ days', from: 91, to: 100000 },
  ];
  return Promise.all(
    buckets.map(async (b) => {
      const agg = await prisma.invoice.aggregate({
        where: {
          ...scope,
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] },
          balanceDue: { gt: 0 },
          dueDate: { lte: addDays(today, -b.from), gte: addDays(today, -b.to) },
        },
        _sum: { balanceDue: true },
        _count: true,
      });
      return { bucket: b.label, amount: toMoneyString(agg._sum.balanceDue ?? 0), count: agg._count };
    }),
  );
}

export async function financeReport(f: ReportFilters, today: Date) {
  const scope = invoiceScope(f);
  const invoicedWhere: Prisma.InvoiceWhereInput = {
    ...scope,
    status: f.invoiceStatus ? f.invoiceStatus : { in: [...REVENUE_STATUSES] },
    invoiceDate: { gte: f.from, lte: f.to },
  };
  const paymentWhere: Prisma.PaymentWhereInput = {
    status: 'COMPLETED',
    paymentDate: { gte: f.from, lte: f.to },
    customerId: f.customerId,
    method: f.paymentMethod,
  };
  const [subCounts, recurring, invoiced, collected, byMethod, rec, invoiceStatusCounts, series, aged, topCustomers] = await Promise.all([
    prisma.subscription.groupBy({ by: ['status'], where: subscriptionWhere(f), _count: true }),
    recurringRevenue(subscriptionWhere(f)),
    prisma.invoice.aggregate({ where: invoicedWhere, _sum: { total: true, discountTotal: true, taxTotal: true }, _count: true }),
    prisma.payment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({ by: ['method'], where: paymentWhere, _sum: { amount: true }, _count: true }),
    receivables(today, scope),
    prisma.invoice.groupBy({ by: ['status'], where: { ...scope, invoiceDate: { gte: f.from, lte: f.to } }, _count: true, _sum: { total: true } }),
    revenueSeries(f),
    ageing(today, scope),
    prisma.invoice.groupBy({
      by: ['customerId'],
      where: invoicedWhere,
      _sum: { total: true, balanceDue: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    }),
  ]);
  const customers = await prisma.customer.findMany({
    where: { id: { in: topCustomers.map((t) => t.customerId) } },
    select: { id: true, name: true, companyName: true },
  });
  return {
    period: { from: formatDateOnly(f.from), to: formatDateOnly(f.to) },
    activeSubscriptions: subCounts.find((s) => s.status === 'ACTIVE')?._count ?? 0,
    subscriptionsByStatus: Object.fromEntries(subCounts.map((s) => [s.status, s._count])),
    recurring,
    invoiced: { amount: toMoneyString(invoiced._sum.total ?? 0), count: invoiced._count, tax: toMoneyString(invoiced._sum.taxTotal ?? 0) },
    collected: { amount: toMoneyString(collected._sum.amount ?? 0), count: collected._count },
    discountsGiven: toMoneyString(invoiced._sum.discountTotal ?? 0),
    ...rec,
    paymentsByMethod: byMethod
      .map((m) => ({ method: m.method, count: m._count, amount: toMoneyString(m._sum.amount ?? 0) }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    invoicesByStatus: invoiceStatusCounts.map((s) => ({ status: s.status, count: s._count, amount: toMoneyString(s._sum.total ?? 0) })),
    revenueSeries: series,
    ageing: aged,
    topCustomers: topCustomers.map((t) => {
      const c = customers.find((x) => x.id === t.customerId);
      return {
        customerId: t.customerId,
        name: c ? c.companyName ?? c.name : 'Unknown',
        invoiced: toMoneyString(t._sum.total ?? 0),
        outstanding: toMoneyString(t._sum.balanceDue ?? 0),
      };
    }),
    definitions: REPORT_DEFINITIONS,
  };
}
