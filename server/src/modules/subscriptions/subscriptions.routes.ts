import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateString, idParam, optionalDateString, optionalText, optionalUuid, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/sequence';
import { businessToday, getSettings } from '../../lib/settings';
import { requirePermission } from '../../middleware/auth';
import { addDays, formatDateOnly, toDateOnly } from '../../domain/dates';
import { EDITABLE_SUBSCRIPTION_STATUSES } from '../../domain/lifecycle';
import { lineInput, priceDraft, type LineInput } from '../../services/documentPricing';
import {
  activateSubscription,
  closeSubscription,
  confirmSubscription,
  createSubscription,
  pauseSubscription,
  recordEvent,
  renewSubscription,
  resumeSubscription,
  subscriptionLineRows,
  totalsFrom,
  upcomingSchedule,
} from '../../services/subscriptions';
import { quotationLineRows } from '../quotations/quotations.routes';
import { notifyQuotation } from '../../services/notifications';

export const subscriptionsRouter = Router();

const createFields = z
  .object({
    customerId: z.string().uuid('Select a customer'),
    planId: z.string().uuid('Select a plan'),
    startDate: dateString,
    endDate: optionalDateString,
    paymentTermsDays: z.coerce.number().int().min(0).max(180).optional(),
    autoRenew: z.boolean().optional(),
    autoClose: z.boolean().optional(),
    lines: z.array(lineInput).min(1, 'Add at least one line').max(100),
    discountId: optionalUuid,
    notes: optionalText(2000),
  })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, { path: ['endDate'], message: 'End date must be on or after the start date' });

subscriptionsRouter.get('/', requirePermission('subscriptions:read'), async (req, res) => {
  const q = parse(
    paginationQuery.extend({
      status: z.enum(['DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE', 'PAUSED', 'CLOSED']).optional(),
      customerId: z.string().uuid().optional(),
      planId: z.string().uuid().optional(),
      billingFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
      view: z.enum(['endingSoon', 'dueForBilling']).optional(),
    }),
    req.query,
  );
  const today = await businessToday();
  const where: Prisma.SubscriptionWhereInput = {
    status: q.status,
    customerId: q.customerId,
    planId: q.planId,
    billingFrequency: q.billingFrequency,
    ...(q.view === 'endingSoon' ? { status: { in: ['ACTIVE', 'PAUSED'] }, endDate: { gte: today, lte: addDays(today, 30) } } : {}),
    ...(q.view === 'dueForBilling' ? { status: 'ACTIVE', nextBillingDate: { lte: today } } : {}),
    ...(q.search
      ? {
          OR: [
            { number: { contains: q.search, mode: 'insensitive' } },
            { customer: { name: { contains: q.search, mode: 'insensitive' } } },
            { customer: { companyName: { contains: q.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: orderBy(q, ['number', 'startDate', 'endDate', 'nextBillingDate', 'total', 'createdAt'] as const, 'createdAt'),
      ...pageArgs(q),
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
        closeReason: true,
        customer: { select: { id: true, name: true, companyName: true } },
        plan: { select: { id: true, name: true } },
      },
    }),
  ]);
  res.json({ data: items, meta: pageMeta(q, total) });
});

subscriptionsRouter.get('/:id', requirePermission('subscriptions:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, companyName: true, email: true, phone: true } },
      plan: true,
      discount: { select: { id: true, code: true, name: true, type: true, value: true } },
      createdBy: { select: { name: true } },
      quotation: { select: { id: true, number: true, status: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: { product: { select: { id: true, name: true, status: true } }, variant: { select: { id: true, name: true, attribute: true } }, taxRule: { select: { id: true, name: true, rate: true } } },
      },
      events: { orderBy: { createdAt: 'desc' }, take: 100, include: { actor: { select: { name: true } } } },
      invoices: {
        orderBy: { invoiceDate: 'desc' },
        take: 50,
        select: { id: true, number: true, status: true, invoiceDate: true, dueDate: true, periodStart: true, periodEnd: true, total: true, balanceDue: true },
      },
      changeRequests: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!sub) throw notFound('Subscription');
  const today = await businessToday();
  res.json({
    data: {
      ...sub,
      upcomingBillingDates: upcomingSchedule(sub),
      isExpired: Boolean(sub.endDate && sub.endDate < today && sub.status !== 'CLOSED'),
      invoices: sub.invoices.map((i) => ({
        ...i,
        isOverdue: ['CONFIRMED', 'PARTIALLY_PAID'].includes(i.status) && i.dueDate < today && Number(i.balanceDue) > 0,
      })),
    },
  });
});

subscriptionsRouter.post('/', requirePermission('subscriptions:write'), async (req, res) => {
  const body = parse(createFields, req.body);
  const startDate = toDateOnly(body.startDate);
  const pricing = await priceDraft(prisma, { planId: body.planId, lines: body.lines, date: startDate, discountId: body.discountId });
  const sub = await prisma.$transaction(async (tx) => {
    const created = await createSubscription(tx, {
      customerId: body.customerId,
      planId: body.planId,
      status: 'DRAFT',
      startDate,
      endDate: body.endDate ? toDateOnly(body.endDate) : undefined,
      paymentTermsDays: body.paymentTermsDays,
      autoRenew: body.autoRenew,
      autoClose: body.autoClose,
      notes: body.notes,
      discountId: pricing.discount?.id ?? null,
      pricing,
      actorId: req.user!.id,
    });
    await recordEvent(tx, created.id, req.user!.id, 'CREATED', 'Subscription created as draft', null, 'DRAFT');
    await audit({ actorId: req.user!.id, action: 'SUBSCRIPTION_CREATED', entityType: 'Subscription', entityId: created.id }, tx);
    return created;
  });
  res.status(201).json({ data: sub });
});

/**
 * Editing rules:
 *  - Draft / Quotation: everything (plan, dates, lines, discount)
 *  - Confirmed / Active / Paused: lines (e.g. switching add-ons on/off — applies from the next invoice),
 *    payment terms, renewal flags and notes. The plan and start date are fixed once confirmed.
 *  - Closed: read-only
 */
subscriptionsRouter.patch('/:id', requirePermission('subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const existing = await prisma.subscription.findUnique({ where: { id } });
  if (!existing) throw notFound('Subscription');
  if (existing.status === 'CLOSED') throw unprocessable('Closed subscriptions cannot be edited');
  const editable = EDITABLE_SUBSCRIPTION_STATUSES.includes(existing.status);
  const body = parse(
    z.object({
      planId: z.string().uuid().optional(),
      startDate: dateString.optional(),
      endDate: optionalDateString,
      paymentTermsDays: z.coerce.number().int().min(0).max(180).optional(),
      autoRenew: z.boolean().optional(),
      autoClose: z.boolean().optional(),
      lines: z.array(lineInput).min(1).max(100).optional(),
      discountId: optionalUuid,
      notes: optionalText(2000),
    }),
    req.body,
  );
  if (!editable && (body.planId || body.startDate)) throw unprocessable('The plan and start date cannot change after confirmation');
  const planId = body.planId ?? existing.planId;
  const startDate = body.startDate ? toDateOnly(body.startDate) : existing.startDate;
  const endDate = body.endDate === undefined ? existing.endDate : body.endDate ? toDateOnly(body.endDate) : null;
  if (endDate && endDate < startDate) throw unprocessable('End date must be on or after the start date');

  const data: Prisma.SubscriptionUncheckedUpdateInput = {
    paymentTermsDays: body.paymentTermsDays,
    autoRenew: body.autoRenew,
    autoClose: body.autoClose,
    notes: body.notes,
    endDate,
  };
  if (editable) {
    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } });
    Object.assign(data, {
      planId,
      startDate,
      billingFrequency: plan.billingFrequency,
      billingInterval: plan.billingInterval,
      billingAnchorDay: startDate.getUTCDate(),
      currency: plan.currency,
    });
  }
  const lines: LineInput[] | undefined = body.lines;
  if (!lines && (body.planId || body.discountId !== undefined)) {
    throw unprocessable('Send the subscription lines when changing the plan or discount');
  }
  const pricing = lines
    ? await priceDraft(prisma, {
        planId,
        lines,
        date: editable ? startDate : await businessToday(),
        discountId: body.discountId === undefined ? existing.discountId : body.discountId,
        subscriptionId: id,
        skipPlanChecks: !editable,
      })
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    if (pricing) {
      await tx.subscriptionLine.deleteMany({ where: { subscriptionId: id } });
      await tx.subscriptionLine.createMany({ data: subscriptionLineRows(pricing.lines).map((l) => ({ ...l, subscriptionId: id })) });
      Object.assign(data, totalsFrom(pricing), { discountId: pricing.discount?.id ?? null });
    }
    const u = await tx.subscription.update({ where: { id }, data });
    await recordEvent(
      tx,
      id,
      req.user!.id,
      'UPDATED',
      pricing ? `Subscription updated; recurring total now ${pricing.total}${editable ? '' : ' (applies from the next invoice)'}` : 'Subscription settings updated',
    );
    await audit({ actorId: req.user!.id, action: 'SUBSCRIPTION_UPDATED', entityType: 'Subscription', entityId: id, details: Object.keys(body) }, tx);
    return u;
  });
  res.json({ data: updated });
});

/** Raises (or refreshes) a quotation from a draft subscription and emails it: Draft → Quotation. */
subscriptionsRouter.post('/:id/send-quotation', requirePermission('subscriptions:write', 'quotations:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const sub = await prisma.subscription.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: 'asc' } }, quotation: true } });
  if (!sub) throw notFound('Subscription');
  if (!['DRAFT', 'QUOTATION'].includes(sub.status)) throw unprocessable('Only draft subscriptions can be sent as a quotation');
  if (sub.quotation && sub.quotation.status === 'CONVERTED') throw unprocessable('The quotation was already converted');
  const settings = await getSettings();
  const today = await businessToday();
  const rows = sub.lines.map((l) => ({
    type: (l.isPlanFee ? 'PLAN' : 'PRODUCT') as 'PLAN' | 'PRODUCT',
    planId: l.isPlanFee ? sub.planId : null,
    productId: l.productId,
    variantId: l.variantId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice.toFixed(2),
    discountPercent: l.discountPercent.toFixed(4),
    taxRuleId: l.taxRuleId,
    taxRate: l.taxRate.toFixed(4),
    lineSubtotal: l.lineSubtotal.toFixed(2),
    discountAmount: l.discountAmount.toFixed(2),
    taxAmount: l.taxAmount.toFixed(2),
    lineTotal: l.lineTotal.toFixed(2),
    sortOrder: l.sortOrder,
  }));
  const quotation = await prisma.$transaction(async (tx) => {
    const common = {
      customerId: sub.customerId,
      planId: sub.planId,
      quotationDate: today,
      validityDays: settings.quotationValidityDays,
      validUntil: addDays(today, settings.quotationValidityDays),
      status: 'SENT' as const,
      sentAt: new Date(),
      currency: sub.currency,
      discountId: sub.discountId,
      subtotal: sub.subtotal,
      discountTotal: sub.discountTotal,
      taxTotal: sub.taxTotal,
      total: sub.total,
      notes: sub.notes,
    };
    let q;
    if (sub.quotation) {
      await tx.quotationLine.deleteMany({ where: { quotationId: sub.quotation.id } });
      q = await tx.quotation.update({ where: { id: sub.quotation.id }, data: { ...common, rejectionReason: null, lines: { create: quotationLineRows(rows) } } });
    } else {
      q = await tx.quotation.create({
        data: {
          ...common,
          number: await nextNumber(tx, 'QT', today.getUTCFullYear()),
          subscriptionId: sub.id,
          createdById: req.user!.id,
          lines: { create: quotationLineRows(rows) },
        },
      });
    }
    if (sub.status === 'DRAFT') {
      await tx.subscription.update({ where: { id }, data: { status: 'QUOTATION' } });
      await recordEvent(tx, id, req.user!.id, 'STATUS_CHANGED', `Quotation ${q.number} sent to the customer`, 'DRAFT', 'QUOTATION');
    } else {
      await recordEvent(tx, id, req.user!.id, 'UPDATED', `Quotation ${q.number} re-sent`);
    }
    await audit({ actorId: req.user!.id, action: 'QUOTATION_SENT', entityType: 'Quotation', entityId: q.id }, tx);
    return q;
  });
  try {
    await notifyQuotation(quotation.id);
  } catch (err) {
    // Email failed: put the subscription back to where it was; the quotation stays as a draft the team can resend.
    if (sub.status === 'DRAFT') await prisma.subscription.update({ where: { id }, data: { status: 'DRAFT' } });
    await prisma.quotation.update({ where: { id: quotation.id }, data: { status: 'DRAFT', sentAt: null } });
    throw err;
  }
  res.json({ data: quotation });
});

const actionBody = z.object({ reason: optionalText(500) });

subscriptionsRouter.post('/:id/confirm', requirePermission('subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json({ data: await confirmSubscription(id, req.user!.id) });
});
subscriptionsRouter.post('/:id/activate', requirePermission('subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json({ data: await activateSubscription(id, req.user!.id) });
});
subscriptionsRouter.post('/:id/pause', requirePermission('subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(actionBody, req.body ?? {});
  res.json({ data: await pauseSubscription(id, req.user!.id, body.reason) });
});
subscriptionsRouter.post('/:id/resume', requirePermission('subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json({ data: await resumeSubscription(id, req.user!.id) });
});
subscriptionsRouter.post('/:id/close', requirePermission('subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(actionBody, req.body ?? {});
  res.json({ data: await closeSubscription(id, req.user!.id, body.reason) });
});
subscriptionsRouter.post('/:id/renew', requirePermission('subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ periods: z.coerce.number().int().min(1).max(120).optional() }), req.body ?? {});
  res.json({ data: await renewSubscription(id, req.user!.id, body.periods) });
});

/**
 * Billing-schedule correction (also used to demonstrate recurring billing without waiting a month).
 * Safe: the billing engine's idempotency key prevents re-invoicing a period that was already billed.
 */
subscriptionsRouter.patch('/:id/next-billing-date', requirePermission('subscriptions:write', 'billing:run'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ nextBillingDate: dateString }), req.body);
  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) throw notFound('Subscription');
  if (sub.status !== 'ACTIVE' && sub.status !== 'PAUSED') throw unprocessable('Only active or paused subscriptions have a billing schedule');
  const date = toDateOnly(body.nextBillingDate);
  if (date < sub.startDate) throw unprocessable('Next billing date cannot be before the start date');
  if (sub.endDate && date > sub.endDate) throw unprocessable('Next billing date cannot be after the end date');
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.subscription.update({ where: { id }, data: { nextBillingDate: date } });
    await recordEvent(
      tx,
      id,
      req.user!.id,
      'SCHEDULE_CHANGED',
      `Next billing date changed from ${sub.nextBillingDate ? formatDateOnly(sub.nextBillingDate) : '—'} to ${body.nextBillingDate}`,
    );
    await audit(
      {
        actorId: req.user!.id,
        action: 'NEXT_BILLING_DATE_CHANGED',
        entityType: 'Subscription',
        entityId: id,
        details: { from: sub.nextBillingDate ? formatDateOnly(sub.nextBillingDate) : null, to: body.nextBillingDate },
      },
      tx,
    );
    return u;
  });
  res.json({ data: updated });
});
