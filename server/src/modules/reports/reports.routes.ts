import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateString, parse } from '../../lib/http';
import { unprocessable } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { businessToday, getSettings } from '../../lib/settings';
import { addDays, formatDateOnly, toDateOnly } from '../../domain/dates';
import { displayInvoiceStatus } from '../../domain/lifecycle';
import { toMoneyString } from '../../domain/money';
import { financeReport, receivables, recurringRevenue, revenueSeries, type ReportFilters } from '../../services/reports';
import { pdfMoney, renderReportPdf } from '../../services/pdf';
import { audit } from '../../lib/audit';

export const dashboardRouter = Router();
export const reportsRouter = Router();

/** Admin/staff overview — every figure is aggregated from persisted records. */
dashboardRouter.get('/summary', requirePermission('dashboard:view'), async (_req, res) => {
  const today = await businessToday();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const trendFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const [
    totalCustomers,
    statusCounts,
    endingSoon,
    recurring,
    collectedThisMonth,
    invoicedThisMonth,
    rec,
    recentInvoices,
    recentPayments,
    trend,
    upcoming,
    pendingRequests,
    lastRun,
    dueNow,
  ] = await Promise.all([
    prisma.customer.count({ where: { status: 'ACTIVE' } }),
    prisma.subscription.groupBy({ by: ['status'], _count: true }),
    prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'PAUSED'] }, endDate: { gte: today, lte: addDays(today, 30) } } }),
    recurringRevenue(),
    prisma.payment.aggregate({ where: { status: 'COMPLETED', paymentDate: { gte: monthStart, lte: today } }, _sum: { amount: true } }),
    prisma.invoice.aggregate({
      where: { status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] }, invoiceDate: { gte: monthStart, lte: today } },
      _sum: { total: true },
    }),
    receivables(today),
    prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, number: true, status: true, invoiceDate: true, dueDate: true, total: true, balanceDue: true, billToName: true },
    }),
    prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      take: 6,
      select: { id: true, number: true, method: true, amount: true, paymentDate: true, customer: { select: { name: true, companyName: true } } },
    }),
    revenueSeries({ from: trendFrom, to: today }),
    prisma.subscription.findMany({
      where: { status: 'ACTIVE', nextBillingDate: { gte: today, lte: addDays(today, 14) } },
      orderBy: { nextBillingDate: 'asc' },
      take: 8,
      select: { id: true, number: true, nextBillingDate: true, total: true, endDate: true, customer: { select: { name: true, companyName: true } }, plan: { select: { name: true } } },
    }),
    prisma.changeRequest.count({ where: { status: 'PENDING' } }),
    prisma.billingJobRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', nextBillingDate: { lte: today } } }),
  ]);
  res.json({
    data: {
      today: formatDateOnly(today),
      totalCustomers,
      activeSubscriptions: statusCounts.find((s) => s.status === 'ACTIVE')?._count ?? 0,
      subscriptionsByStatus: Object.fromEntries(statusCounts.map((s) => [s.status, s._count])),
      endingSoon,
      mrr: recurring.mrr,
      arr: recurring.arr,
      collectedThisMonth: toMoneyString(collectedThisMonth._sum.amount ?? 0),
      invoicedThisMonth: toMoneyString(invoicedThisMonth._sum.total ?? 0),
      ...rec,
      recentInvoices: recentInvoices.map((i) => ({ ...i, displayStatus: displayInvoiceStatus(i, today) })),
      recentPayments,
      revenueTrend: trend,
      upcomingBilling: upcoming,
      pendingRequests,
      lastBillingRun: lastRun,
      dueForBilling: dueNow,
    },
  });
});

const reportQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  billingFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  customerId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  invoiceStatus: z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']).optional(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CARD', 'CASH', 'UPI', 'CHEQUE', 'OTHER']).optional(),
});

async function filters(query: unknown): Promise<ReportFilters> {
  const q = parse(reportQuery, query);
  const today = await businessToday();
  const to = q.to ? toDateOnly(q.to) : today;
  const from = q.from ? toDateOnly(q.from) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  if (from > to) throw unprocessable('"From" must be on or before "To"');
  if ((to.getTime() - from.getTime()) / 86_400_000 > 366 * 5) throw unprocessable('Choose a range of at most 5 years');
  return { ...q, from, to };
}

reportsRouter.get('/finance', requirePermission('reports:view'), async (req, res) => {
  const f = await filters(req.query);
  res.json({ data: await financeReport(f, await businessToday()) });
});

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

/** CSV exports: summary | invoices | payments (respecting the same filters). */
reportsRouter.get('/finance/export.csv', requirePermission('reports:view'), async (req, res) => {
  const f = await filters(req.query);
  const kind = parse(z.object({ kind: z.enum(['summary', 'invoices', 'payments']).default('summary') }), { kind: req.query.kind }).kind;
  const today = await businessToday();
  let body: string;
  if (kind === 'invoices') {
    // Formatted by PostgreSQL (text columns) — far faster than materialising Prisma/Decimal objects for tens of thousands of rows.
    const conds: Prisma.Sql[] = [Prisma.sql`i."invoiceDate" BETWEEN ${f.from} AND ${f.to}`];
    if (f.customerId) conds.push(Prisma.sql`i."customerId" = ${f.customerId}`);
    if (f.invoiceStatus) conds.push(Prisma.sql`i."status"::text = ${f.invoiceStatus}`);
    if (f.planId) conds.push(Prisma.sql`s."planId" = ${f.planId}`);
    if (f.billingFrequency) conds.push(Prisma.sql`s."billingFrequency"::text = ${f.billingFrequency}`);
    const rows = await prisma.$queryRaw<{ cols: string[] }[]>`
      SELECT ARRAY[i."number", to_char(i."invoiceDate", 'YYYY-MM-DD'), to_char(i."dueDate", 'YYYY-MM-DD'),
        CASE WHEN i."status" IN ('CONFIRMED','PARTIALLY_PAID') AND i."balanceDue" > 0 AND i."dueDate" < ${today}::date THEN 'OVERDUE' ELSE i."status"::text END,
        i."billToName", COALESCE(s."number", ''), i."subtotal"::text, i."discountTotal"::text, i."taxTotal"::text, i."total"::text,
        i."amountPaid"::text, i."balanceDue"::text, i."currency"] AS cols
      FROM "Invoice" i LEFT JOIN "Subscription" s ON s."id" = i."subscriptionId"
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY i."invoiceDate", i."number" LIMIT 200000`;
    body = csv([
      ['Invoice', 'Invoice date', 'Due date', 'Status', 'Customer', 'Subscription', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Currency'],
      ...rows.map((r) => r.cols),
    ]);
  } else if (kind === 'payments') {
    const conds: Prisma.Sql[] = [Prisma.sql`p."paymentDate" BETWEEN ${f.from} AND ${f.to}`];
    if (f.customerId) conds.push(Prisma.sql`p."customerId" = ${f.customerId}`);
    if (f.paymentMethod) conds.push(Prisma.sql`p."method"::text = ${f.paymentMethod}`);
    const rows = await prisma.$queryRaw<{ cols: string[] }[]>`
      SELECT ARRAY[p."number", to_char(p."paymentDate", 'YYYY-MM-DD'), COALESCE(c."companyName", c."name"), p."method"::text, p."amount"::text,
        COALESCE(p."reference", ''), p."status"::text,
        COALESCE((SELECT string_agg(i."number" || ':' || a."amount"::text, ' ') FROM "PaymentAllocation" a JOIN "Invoice" i ON i."id" = a."invoiceId" WHERE a."paymentId" = p."id"), ''),
        COALESCE(p."notes", '')] AS cols
      FROM "Payment" p JOIN "Customer" c ON c."id" = p."customerId"
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY p."paymentDate", p."number" LIMIT 200000`;
    body = csv([['Payment', 'Date', 'Customer', 'Method', 'Amount', 'Reference', 'Status', 'Invoices', 'Notes'], ...rows.map((r) => r.cols)]);
  } else {
    const r = await financeReport(f, today);
    body = csv([
      ['Brightloop Software — Finance summary'],
      ['Period', r.period.from, r.period.to],
      [],
      ['Metric', 'Value'],
      ['Active subscriptions', r.activeSubscriptions],
      ['MRR', r.recurring.mrr],
      ['ARR', r.recurring.arr],
      ['Invoiced revenue', r.invoiced.amount],
      ['Collected revenue', r.collected.amount],
      ['Outstanding', r.outstanding],
      ['Overdue', r.overdue],
      ['Overdue invoices', r.overdueCount],
      ['Discounts given', r.discountsGiven],
      [],
      ['Month', 'Invoiced', 'Collected'],
      ...r.revenueSeries.map((m) => [m.month, m.invoiced, m.collected]),
      [],
      ['Payment method', 'Count', 'Amount'],
      ...r.paymentsByMethod.map((m) => [m.method, m.count, m.amount]),
      [],
      ['Subscription status', 'Count'],
      ...Object.entries(r.subscriptionsByStatus),
    ]);
  }
  await audit({ actorId: req.user!.id, action: 'REPORT_EXPORTED', entityType: 'Report', details: { kind, format: 'csv' } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="brightloop-${kind}-${formatDateOnly(f.from)}-to-${formatDateOnly(f.to)}.csv"`);
  res.send('﻿' + body);
});

reportsRouter.get('/finance/export.pdf', requirePermission('reports:view'), async (req, res) => {
  const f = await filters(req.query);
  const settings = await getSettings();
  const r = await financeReport(f, await businessToday());
  const c = settings.currency;
  const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
  const pdf = await renderReportPdf(
    {
      title: 'Finance summary',
      periodLabel: `Period ${r.period.from} to ${r.period.to} · outstanding and overdue as of today`,
      currency: c,
      kpis: [
        ['Active subscriptions', String(r.activeSubscriptions)],
        ['MRR', pdfMoney(r.recurring.mrr, c)],
        ['ARR', pdfMoney(r.recurring.arr, c)],
        ['Invoiced revenue', pdfMoney(r.invoiced.amount, c)],
        ['Collected revenue', pdfMoney(r.collected.amount, c)],
        ['Discounts given', pdfMoney(r.discountsGiven, c)],
        ['Outstanding', pdfMoney(r.outstanding, c)],
        ['Overdue', pdfMoney(r.overdue, c)],
        ['Overdue invoices', String(r.overdueCount)],
      ],
      tables: [
        { title: 'Revenue by month', columns: ['Month', 'Invoiced', 'Collected'], rows: r.revenueSeries.map((m) => [m.month, pdfMoney(m.invoiced, c), pdfMoney(m.collected, c)]) },
        { title: 'Payments by method', columns: ['Method', 'Payments', 'Amount'], rows: r.paymentsByMethod.map((m) => [label(m.method), String(m.count), pdfMoney(m.amount, c)]) },
        { title: 'Overdue ageing', columns: ['Bucket', 'Invoices', 'Amount'], rows: r.ageing.map((a) => [a.bucket, String(a.count), pdfMoney(a.amount, c)]) },
        { title: 'Subscriptions by status', columns: ['Status', 'Count'], rows: Object.entries(r.subscriptionsByStatus).map(([k, v]) => [label(k), String(v)]) },
        { title: 'Top customers (period)', columns: ['Customer', 'Invoiced', 'Unpaid'], rows: r.topCustomers.map((t) => [t.name, pdfMoney(t.invoiced, c), pdfMoney(t.outstanding, c)]) },
      ],
      definitions: r.definitions,
    },
    settings,
  );
  await audit({ actorId: req.user!.id, action: 'REPORT_EXPORTED', entityType: 'Report', details: { format: 'pdf' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="brightloop-finance-${r.period.from}-to-${r.period.to}.pdf"`);
  res.send(pdf);
});
