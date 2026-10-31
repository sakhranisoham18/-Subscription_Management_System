import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { idParam, optionalText, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/sequence';
import { businessToday, getSettings } from '../../lib/settings';
import { currentCustomerId, requireCustomer } from '../../middleware/auth';
import { addDays } from '../../domain/dates';
import { displayInvoiceStatus } from '../../domain/lifecycle';
import { toMoneyString } from '../../domain/money';
import { priceDraft } from '../../services/documentPricing';
import { upcomingSchedule } from '../../services/subscriptions';
import { acceptQuotation, rejectQuotation } from '../../services/quotations';
import { invoicePdf, quotationPdf } from '../../services/notifications';
import { invoiceStatusFilter, invoiceWhere } from '../invoices/invoices.routes';
import { quotationLineRows } from '../quotations/quotations.routes';

/**
 * Customer self-service portal. EVERY query is scoped by the authenticated user's customerId,
 * taken from the server-side session — never from the URL or request body. Requests for another
 * customer's record return 404 (not 403) so record existence is not revealed.
 */
export const portalRouter = Router();
portalRouter.use(requireCustomer);

/** Display settings customers need to format money and dates (no internal configuration is exposed). */
portalRouter.get('/config', async (_req, res) => {
  const s = await getSettings();
  res.json({ data: { currency: s.currency, timezone: s.timezone, companyName: s.companyName } });
});

portalRouter.get('/dashboard', async (req, res) => {
  const customerId = currentCustomerId(req);
  const today = await businessToday();
  const [active, nextBilling, recentInvoices, outstanding, overdue, payments, expiring, pendingQuotes] = await Promise.all([
    prisma.subscription.count({ where: { customerId, status: 'ACTIVE' } }),
    prisma.subscription.findFirst({
      where: { customerId, status: 'ACTIVE', nextBillingDate: { not: null } },
      orderBy: { nextBillingDate: 'asc' },
      select: { id: true, number: true, nextBillingDate: true, total: true, currency: true, plan: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { customerId, status: { not: 'DRAFT' } },
      orderBy: { invoiceDate: 'desc' },
      take: 5,
      select: { id: true, number: true, status: true, invoiceDate: true, dueDate: true, total: true, balanceDue: true, currency: true },
    }),
    prisma.invoice.aggregate({ where: { customerId, status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] } }, _sum: { balanceDue: true } }),
    prisma.invoice.aggregate({
      where: { customerId, status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, dueDate: { lt: today }, balanceDue: { gt: 0 } },
      _sum: { balanceDue: true },
      _count: true,
    }),
    prisma.payment.findMany({
      where: { customerId, status: 'COMPLETED' },
      orderBy: { paymentDate: 'desc' },
      take: 5,
      select: { id: true, number: true, method: true, amount: true, paymentDate: true },
    }),
    prisma.subscription.findMany({
      where: { customerId, status: { in: ['ACTIVE', 'PAUSED'] }, endDate: { not: null } },
      orderBy: { endDate: 'asc' },
      take: 5,
      select: { id: true, number: true, status: true, endDate: true, autoRenew: true, plan: { select: { name: true } } },
    }),
    prisma.quotation.count({ where: { customerId, status: 'SENT' } }),
  ]);
  res.json({
    data: {
      activeSubscriptions: active,
      nextBilling,
      outstanding: toMoneyString(outstanding._sum.balanceDue ?? 0),
      overdue: toMoneyString(overdue._sum.balanceDue ?? 0),
      overdueCount: overdue._count,
      recentInvoices: recentInvoices.map((i) => ({ ...i, displayStatus: displayInvoiceStatus(i, today) })),
      recentPayments: payments,
      renewals: expiring,
      pendingQuotations: pendingQuotes,
    },
  });
});

// ── Subscriptions ──
portalRouter.get('/subscriptions', async (req, res) => {
  const customerId = currentCustomerId(req);
  const items = await prisma.subscription.findMany({
    // Draft subscriptions are internal work-in-progress and are not shown to customers.
    where: { customerId, status: { not: 'DRAFT' } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      number: true,
      status: true,
      startDate: true,
      endDate: true,
      nextBillingDate: true,
      billingFrequency: true,
      total: true,
      currency: true,
      autoRenew: true,
      closeReason: true,
      plan: { select: { name: true } },
    },
  });
  res.json({ data: items });
});

portalRouter.get('/subscriptions/:id', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const sub = await prisma.subscription.findFirst({
    where: { id, customerId, status: { not: 'DRAFT' } },
    include: {
      plan: { select: { name: true, description: true, billingFrequency: true, allowPause: true, allowEarlyClose: true, allowRenew: true } },
      lines: { orderBy: { sortOrder: 'asc' } },
      invoices: {
        where: { status: { not: 'DRAFT' } },
        orderBy: { invoiceDate: 'desc' },
        select: { id: true, number: true, status: true, invoiceDate: true, dueDate: true, total: true, balanceDue: true },
      },
      changeRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!sub) throw notFound('Subscription');
  const today = await businessToday();
  res.json({
    data: {
      ...sub,
      upcomingBillingDates: upcomingSchedule(sub),
      invoices: sub.invoices.map((i) => ({ ...i, displayStatus: displayInvoiceStatus(i, today) })),
    },
  });
});

/** Customers can ask to pause, resume, renew or cancel — staff review and approve. */
portalRouter.post('/subscriptions/:id/requests', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ type: z.enum(['PAUSE', 'RESUME', 'RENEW', 'CANCEL']), message: optionalText(1000) }), req.body);
  const sub = await prisma.subscription.findFirst({ where: { id, customerId }, include: { plan: true } });
  if (!sub) throw notFound('Subscription');
  const allowed: Record<typeof body.type, boolean> = {
    PAUSE: sub.status === 'ACTIVE' && sub.plan.allowPause,
    RESUME: sub.status === 'PAUSED',
    RENEW: sub.plan.allowRenew && Boolean(sub.endDate) && ['ACTIVE', 'PAUSED', 'CLOSED'].includes(sub.status),
    CANCEL: ['ACTIVE', 'PAUSED', 'CONFIRMED', 'QUOTATION'].includes(sub.status) && (sub.plan.allowEarlyClose || !['ACTIVE', 'PAUSED'].includes(sub.status)),
  };
  if (!allowed[body.type]) throw unprocessable(`A ${body.type.toLowerCase()} request is not available for this subscription`);
  if (await prisma.changeRequest.findFirst({ where: { subscriptionId: id, status: 'PENDING' } })) {
    throw conflict('You already have a pending request for this subscription');
  }
  const cr = await prisma.changeRequest.create({ data: { subscriptionId: id, customerId, type: body.type, message: body.message ?? null } });
  await prisma.subscriptionEvent.create({
    data: { subscriptionId: id, actorId: req.user!.id, type: 'REQUEST', message: `Customer requested to ${body.type.toLowerCase()}${body.message ? `: ${body.message}` : ''}` },
  });
  await audit({ actorId: req.user!.id, action: 'CHANGE_REQUESTED', entityType: 'Subscription', entityId: id, details: { type: body.type } });
  res.status(201).json({ data: cr });
});

portalRouter.get('/requests', async (req, res) => {
  const customerId = currentCustomerId(req);
  const items = await prisma.changeRequest.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { subscription: { select: { id: true, number: true } } },
  });
  res.json({ data: items });
});

// ── Invoices ──
portalRouter.get('/invoices', async (req, res) => {
  const customerId = currentCustomerId(req);
  const q = parse(paginationQuery.extend({ status: invoiceStatusFilter.optional() }), req.query);
  const today = await businessToday();
  // Draft invoices are not visible to customers.
  const where = { ...invoiceWhere({ ...q, customerId }, today), customerId, NOT: { status: 'DRAFT' as const } };
  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
      ...pageArgs(q),
      select: {
        id: true,
        number: true,
        status: true,
        invoiceDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        currency: true,
        subscription: { select: { number: true } },
      },
    }),
  ]);
  res.json({ data: items.map((i) => ({ ...i, displayStatus: displayInvoiceStatus(i, today) })), meta: pageMeta(q, total) });
});

portalRouter.get('/invoices/:id', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const inv = await prisma.invoice.findFirst({
    where: { id, customerId, NOT: { status: 'DRAFT' } },
    include: {
      lines: { orderBy: { sortOrder: 'asc' } },
      subscription: { select: { id: true, number: true } },
      discount: { select: { code: true, name: true } },
      allocations: { where: { payment: { status: 'COMPLETED' } }, include: { payment: { select: { number: true, method: true, paymentDate: true } } } },
    },
  });
  if (!inv) throw notFound('Invoice');
  res.json({ data: { ...inv, displayStatus: displayInvoiceStatus(inv, await businessToday()) } });
});

portalRouter.get('/invoices/:id/pdf', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const inv = await prisma.invoice.findFirst({ where: { id, customerId, NOT: { status: 'DRAFT' } }, select: { id: true } });
  if (!inv) throw notFound('Invoice');
  const { buffer, filename } = await invoicePdf(id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.send(buffer);
});

// ── Payments ──
portalRouter.get('/payments', async (req, res) => {
  const customerId = currentCustomerId(req);
  const q = parse(paginationQuery, req.query);
  const where = { customerId, status: 'COMPLETED' as const };
  const [total, items] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { paymentDate: 'desc' },
      ...pageArgs(q),
      select: {
        id: true,
        number: true,
        method: true,
        amount: true,
        paymentDate: true,
        reference: true,
        allocations: { select: { amount: true, invoice: { select: { id: true, number: true } } } },
      },
    }),
  ]);
  res.json({ data: items, meta: pageMeta(q, total) });
});

// ── Quotations ──
portalRouter.get('/quotations', async (req, res) => {
  const customerId = currentCustomerId(req);
  const items = await prisma.quotation.findMany({
    where: { customerId, status: { not: 'DRAFT' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true, status: true, quotationDate: true, validUntil: true, total: true, currency: true },
  });
  res.json({ data: items });
});

portalRouter.get('/quotations/:id', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const q = await prisma.quotation.findFirst({
    where: { id, customerId, status: { not: 'DRAFT' } },
    include: { lines: { orderBy: { sortOrder: 'asc' } }, discount: { select: { code: true, name: true } }, subscription: { select: { id: true, number: true } } },
  });
  if (!q) throw notFound('Quotation');
  res.json({ data: q });
});

portalRouter.get('/quotations/:id/pdf', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  if (!(await prisma.quotation.findFirst({ where: { id, customerId, status: { not: 'DRAFT' } }, select: { id: true } }))) throw notFound('Quotation');
  const { buffer, filename } = await quotationPdf(id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.send(buffer);
});

portalRouter.post('/quotations/:id/accept', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const q = await prisma.quotation.findFirst({ where: { id, customerId }, select: { status: true } });
  if (!q) throw notFound('Quotation');
  if (q.status !== 'SENT') throw unprocessable('Only quotations awaiting your response can be accepted');
  res.json({ data: await acceptQuotation(id, req.user!.id, { customerId }) });
});

portalRouter.post('/quotations/:id/reject', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ reason: optionalText(500) }), req.body ?? {});
  const q = await prisma.quotation.findFirst({ where: { id, customerId }, select: { status: true } });
  if (!q) throw notFound('Quotation');
  if (q.status !== 'SENT') throw unprocessable('Only quotations awaiting your response can be declined');
  res.json({ data: await rejectQuotation(id, req.user!.id, body.reason ?? null, { customerId }) });
});

// ── Plans catalogue ──
portalRouter.get('/plans', async (_req, res) => {
  const today = await businessToday();
  const plans = await prisma.subscriptionPlan.findMany({
    where: { status: 'ACTIVE', availableFrom: { lte: today }, OR: [{ availableUntil: null }, { availableUntil: { gte: today } }] },
    orderBy: [{ billingFrequency: 'asc' }, { price: 'asc' }],
    select: { id: true, name: true, description: true, billingFrequency: true, billingInterval: true, price: true, currency: true, minQuantity: true, termLength: true, allowPause: true, allowRenew: true },
  });
  res.json({ data: plans });
});

/** "Request a quote" — creates a draft quotation for the plan that the sales team then reviews and sends. */
portalRouter.post('/plans/:id/request-quote', async (req, res) => {
  const customerId = currentCustomerId(req);
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ quantity: z.coerce.number().int().min(1).max(10000), message: optionalText(1000) }), req.body);
  const today = await businessToday();
  const settings = await getSettings();
  const pricing = await priceDraft(prisma, { planId: id, lines: [{ type: 'PLAN', quantity: body.quantity, discountPercent: '0' }], date: today });
  const q = await prisma.$transaction(async (tx) => {
    const created = await tx.quotation.create({
      data: {
        number: await nextNumber(tx, 'QT', today.getUTCFullYear()),
        customerId,
        planId: id,
        quotationDate: today,
        validityDays: settings.quotationValidityDays,
        validUntil: addDays(today, settings.quotationValidityDays),
        currency: settings.currency,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        taxTotal: pricing.taxTotal,
        total: pricing.total,
        notes: `Requested by the customer via the portal${body.message ? `: ${body.message}` : ''}`,
        lines: { create: quotationLineRows(pricing.lines) },
      },
    });
    await audit({ actorId: req.user!.id, action: 'QUOTE_REQUESTED', entityType: 'Quotation', entityId: created.id }, tx);
    return created;
  });
  res.status(201).json({ data: { id: q.id, number: q.number, message: 'Thanks! Our team will review your request and send you a quotation.' } });
});

// ── Profile ──
const profileSelect = {
  id: true,
  name: true,
  companyName: true,
  email: true,
  phone: true,
  billingContact: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  taxId: true,
  createdAt: true,
} as const;

portalRouter.get('/profile', async (req, res) => {
  const customerId = currentCustomerId(req);
  res.json({ data: await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: profileSelect }) });
});

portalRouter.patch('/profile', async (req, res) => {
  const customerId = currentCustomerId(req);
  // Explicit whitelist — email, status and notes cannot be changed by the customer (mass-assignment protection).
  const body = parse(
    z
      .object({
        name: z.string().trim().min(2).max(120),
        companyName: optionalText(160),
        phone: optionalText(30),
        billingContact: optionalText(120),
        addressLine1: optionalText(200),
        addressLine2: optionalText(200),
        city: optionalText(80),
        state: optionalText(80),
        postalCode: optionalText(20),
        country: optionalText(80),
        taxId: optionalText(40),
      })
      .partial()
      .strict(),
    req.body,
  );
  const customer = await prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({ where: { id: customerId }, data: body, select: profileSelect });
    if (body.name || body.phone !== undefined) {
      await tx.user.update({ where: { id: req.user!.id }, data: { name: body.name, phone: body.phone } });
    }
    await audit({ actorId: req.user!.id, action: 'PROFILE_UPDATED', entityType: 'Customer', entityId: customerId, details: Object.keys(body) }, tx);
    return c;
  });
  res.json({ data: customer });
});
