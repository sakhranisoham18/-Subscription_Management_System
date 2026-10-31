import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateString, idParam, optionalText, optionalUuid, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/sequence';
import { businessToday, getSettings } from '../../lib/settings';
import { requirePermission } from '../../middleware/auth';
import { addDays, toDateOnly } from '../../domain/dates';
import { lineInput, priceDraft, type PricedLineRow } from '../../services/documentPricing';
import { acceptQuotation, convertQuotation, rejectQuotation } from '../../services/quotations';
import { notifyQuotation, quotationPdf } from '../../services/notifications';

export const quotationsRouter = Router();

const draftFields = z.object({
  customerId: z.string().uuid('Select a customer'),
  planId: z.string().uuid('Select a plan'),
  templateId: optionalUuid,
  quotationDate: dateString.optional(),
  validityDays: z.coerce.number().int().min(1).max(365).optional(),
  lines: z.array(lineInput).min(1, 'Add at least one line').max(100),
  discountId: optionalUuid,
  notes: optionalText(2000),
  terms: optionalText(4000),
});

export const quotationLineRows = (rows: PricedLineRow[]) =>
  rows.map((l) => ({
    planId: l.planId,
    productId: l.productId,
    variantId: l.variantId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent,
    taxRuleId: l.taxRuleId,
    taxRate: l.taxRate,
    lineSubtotal: l.lineSubtotal,
    discountAmount: l.discountAmount,
    taxAmount: l.taxAmount,
    lineTotal: l.lineTotal,
    sortOrder: l.sortOrder,
  }));

const detailInclude = {
  customer: { select: { id: true, name: true, companyName: true, email: true } },
  template: { select: { id: true, name: true } },
  discount: { select: { id: true, code: true, name: true, type: true, value: true } },
  subscription: { select: { id: true, number: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, name: true, attribute: true } },
      taxRule: { select: { id: true, name: true } },
    },
  },
};

/** Live pricing preview for the quotation editor (server is the single source of truth for totals). */
quotationsRouter.post('/preview', requirePermission('quotations:write'), async (req, res) => {
  const body = parse(
    z.object({
      planId: optionalUuid,
      lines: z.array(lineInput).min(1),
      discountId: optionalUuid,
      date: dateString.optional(),
      subscriptionId: optionalUuid,
      existing: z.boolean().optional(),
    }),
    req.body,
  );
  const date = body.date ? toDateOnly(body.date) : await businessToday();
  res.json({
    data: await priceDraft(prisma, {
      planId: body.planId ?? null,
      lines: body.lines,
      date,
      discountId: body.discountId,
      subscriptionId: body.subscriptionId,
      // editing lines of an already-confirmed subscription/invoice: plan availability is not re-checked
      skipPlanChecks: body.existing,
    }),
  });
});

quotationsRouter.get('/', requirePermission('quotations:read'), async (req, res) => {
  const q = parse(
    paginationQuery.extend({
      status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED']).optional(),
      customerId: z.string().uuid().optional(),
    }),
    req.query,
  );
  const where: Prisma.QuotationWhereInput = {
    status: q.status,
    customerId: q.customerId,
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
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy: orderBy(q, ['number', 'quotationDate', 'validUntil', 'total', 'createdAt'] as const, 'createdAt'),
      ...pageArgs(q),
      select: {
        id: true,
        number: true,
        status: true,
        quotationDate: true,
        validUntil: true,
        total: true,
        currency: true,
        customer: { select: { id: true, name: true, companyName: true } },
        subscription: { select: { id: true, number: true } },
      },
    }),
  ]);
  res.json({ data: items, meta: pageMeta(q, total) });
});

quotationsRouter.get('/:id', requirePermission('quotations:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const q = await prisma.quotation.findUnique({ where: { id }, include: detailInclude });
  if (!q) throw notFound('Quotation');
  const [plan, history] = await Promise.all([
    q.planId ? prisma.subscriptionPlan.findUnique({ where: { id: q.planId }, select: { id: true, name: true, billingFrequency: true, billingInterval: true } }) : null,
    prisma.auditLog.findMany({ where: { entityType: 'Quotation', entityId: id }, orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true } } } }),
  ]);
  res.json({ data: { ...q, plan, history } });
});

quotationsRouter.post('/', requirePermission('quotations:write'), async (req, res) => {
  const body = parse(draftFields, req.body);
  const settings = await getSettings();
  const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
  if (!customer || customer.status !== 'ACTIVE') throw unprocessable('Select an active customer');
  let validityDays = body.validityDays;
  let terms = body.terms;
  if (body.templateId) {
    const t = await prisma.quotationTemplate.findUnique({ where: { id: body.templateId } });
    if (!t) throw unprocessable('Template not found');
    validityDays ??= t.validityDays;
    terms ??= t.terms;
  }
  validityDays ??= settings.quotationValidityDays;
  const quotationDate = body.quotationDate ? toDateOnly(body.quotationDate) : await businessToday();
  const pricing = await priceDraft(prisma, { planId: body.planId, lines: body.lines, date: quotationDate, discountId: body.discountId });

  const quotation = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'QT', quotationDate.getUTCFullYear());
    const created = await tx.quotation.create({
      data: {
        number,
        customerId: body.customerId,
        planId: body.planId,
        templateId: body.templateId ?? null,
        quotationDate,
        validityDays,
        validUntil: addDays(quotationDate, validityDays!),
        currency: settings.currency,
        discountId: pricing.discount?.id ?? null,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        taxTotal: pricing.taxTotal,
        total: pricing.total,
        notes: body.notes ?? null,
        terms: terms ?? null,
        createdById: req.user!.id,
        lines: { create: quotationLineRows(pricing.lines) },
      },
    });
    await audit({ actorId: req.user!.id, action: 'QUOTATION_CREATED', entityType: 'Quotation', entityId: created.id, details: { total: pricing.total } }, tx);
    return created;
  });
  res.status(201).json({ data: quotation });
});

quotationsRouter.patch('/:id', requirePermission('quotations:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const existing = await prisma.quotation.findUnique({ where: { id } });
  if (!existing) throw notFound('Quotation');
  if (existing.status !== 'DRAFT') throw unprocessable('Only draft quotations can be edited. Revise it back to draft first.');
  const body = parse(draftFields, req.body);
  const quotationDate = body.quotationDate ? toDateOnly(body.quotationDate) : existing.quotationDate;
  const validityDays = body.validityDays ?? existing.validityDays;
  const pricing = await priceDraft(prisma, {
    planId: body.planId,
    lines: body.lines,
    date: quotationDate,
    discountId: body.discountId,
    subscriptionId: existing.subscriptionId,
  });
  const quotation = await prisma.$transaction(async (tx) => {
    await tx.quotationLine.deleteMany({ where: { quotationId: id } });
    const updated = await tx.quotation.update({
      where: { id },
      data: {
        customerId: existing.subscriptionId ? existing.customerId : body.customerId,
        planId: body.planId,
        templateId: body.templateId ?? null,
        quotationDate,
        validityDays,
        validUntil: addDays(quotationDate, validityDays),
        discountId: pricing.discount?.id ?? null,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        taxTotal: pricing.taxTotal,
        total: pricing.total,
        notes: body.notes ?? null,
        terms: body.terms ?? null,
        lines: { create: quotationLineRows(pricing.lines) },
      },
    });
    await audit({ actorId: req.user!.id, action: 'QUOTATION_UPDATED', entityType: 'Quotation', entityId: id, details: { total: pricing.total } }, tx);
    return updated;
  });
  res.json({ data: quotation });
});

quotationsRouter.post('/:id/send', requirePermission('quotations:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw notFound('Quotation');
  if (!['DRAFT', 'SENT'].includes(q.status)) throw unprocessable('Only draft or sent quotations can be (re)sent');
  if (q.validUntil < (await businessToday())) throw unprocessable('This quotation has passed its validity date. Update the date first.');
  await prisma.quotation.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
  if (q.subscriptionId) await prisma.subscription.updateMany({ where: { id: q.subscriptionId, status: 'DRAFT' }, data: { status: 'QUOTATION' } });
  try {
    await notifyQuotation(id);
  } catch (err) {
    // The customer never received it, so it must not look "Sent".
    await prisma.quotation.update({ where: { id }, data: { status: q.status, sentAt: q.sentAt } });
    if (q.subscriptionId) await prisma.subscription.updateMany({ where: { id: q.subscriptionId, status: 'QUOTATION' }, data: { status: 'DRAFT' } });
    throw err;
  }
  await audit({ actorId: req.user!.id, action: 'QUOTATION_SENT', entityType: 'Quotation', entityId: id });
  res.json({ data: { message: 'Quotation sent to the customer' } });
});

quotationsRouter.post('/:id/accept', requirePermission('quotations:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json({ data: await acceptQuotation(id, req.user!.id) });
});

quotationsRouter.post('/:id/reject', requirePermission('quotations:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ reason: optionalText(500) }), req.body ?? {});
  res.json({ data: await rejectQuotation(id, req.user!.id, body.reason ?? null) });
});

quotationsRouter.post('/:id/revise', requirePermission('quotations:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw notFound('Quotation');
  if (!['SENT', 'REJECTED', 'EXPIRED'].includes(q.status)) throw unprocessable('Only sent, rejected or expired quotations can be revised');
  const updated = await prisma.quotation.update({ where: { id }, data: { status: 'DRAFT', rejectionReason: null } });
  await audit({ actorId: req.user!.id, action: 'QUOTATION_REVISED', entityType: 'Quotation', entityId: id });
  res.json({ data: updated });
});

quotationsRouter.post('/:id/convert', requirePermission('quotations:write', 'subscriptions:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(
    z.object({ startDate: dateString.optional(), paymentTermsDays: z.coerce.number().int().min(0).max(180).optional() }),
    req.body ?? {},
  );
  const sub = await convertQuotation(id, req.user!.id, {
    startDate: body.startDate ? toDateOnly(body.startDate) : undefined,
    paymentTermsDays: body.paymentTermsDays,
  });
  res.status(201).json({ data: sub });
});

quotationsRouter.get('/:id/pdf', requirePermission('quotations:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  if (!(await prisma.quotation.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Quotation');
  const { buffer, filename } = await quotationPdf(id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.send(buffer);
});
