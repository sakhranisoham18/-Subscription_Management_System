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
import { displayInvoiceStatus } from '../../domain/lifecycle';
import { d } from '../../domain/money';
import { lineInput, priceDraft } from '../../services/documentPricing';
import { invoicePdf, notifyInvoice } from '../../services/notifications';

export const invoicesRouter = Router();

export const invoiceStatusFilter = z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'OVERDUE', 'OPEN']);

/** Builds the where-clause for invoice list filters ("OVERDUE" and "OPEN" are derived states). */
export function invoiceWhere(
  q: { status?: z.infer<typeof invoiceStatusFilter>; customerId?: string; subscriptionId?: string; from?: string; to?: string; search?: string },
  today: Date,
): Prisma.InvoiceWhereInput {
  const statusWhere: Prisma.InvoiceWhereInput =
    q.status === 'OVERDUE'
      ? { status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, dueDate: { lt: today }, balanceDue: { gt: 0 } }
      : q.status === 'OPEN'
        ? { status: { in: ['CONFIRMED', 'PARTIALLY_PAID'] }, balanceDue: { gt: 0 } }
        : q.status
          ? { status: q.status }
          : {};
  return {
    ...statusWhere,
    customerId: q.customerId,
    subscriptionId: q.subscriptionId,
    ...(q.from || q.to
      ? { invoiceDate: { ...(q.from ? { gte: toDateOnly(q.from) } : {}), ...(q.to ? { lte: toDateOnly(q.to) } : {}) } }
      : {}),
    ...(q.search
      ? {
          OR: [
            { number: { contains: q.search, mode: 'insensitive' } },
            { billToName: { contains: q.search, mode: 'insensitive' } },
            { subscription: { number: { contains: q.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

invoicesRouter.get('/', requirePermission('invoices:read'), async (req, res) => {
  const q = parse(
    paginationQuery.extend({
      status: invoiceStatusFilter.optional(),
      customerId: z.string().uuid().optional(),
      subscriptionId: z.string().uuid().optional(),
      from: dateString.optional(),
      to: dateString.optional(),
    }),
    req.query,
  );
  const today = await businessToday();
  const where = invoiceWhere(q, today);
  const [total, items, sums] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: orderBy(q, ['number', 'invoiceDate', 'dueDate', 'total', 'balanceDue', 'createdAt'] as const, 'invoiceDate'),
      ...pageArgs(q),
      select: {
        id: true,
        number: true,
        status: true,
        source: true,
        invoiceDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        currency: true,
        customer: { select: { id: true, name: true, companyName: true } },
        subscription: { select: { id: true, number: true } },
      },
    }),
    prisma.invoice.aggregate({ where, _sum: { total: true, balanceDue: true } }),
  ]);
  res.json({
    data: items.map((i) => ({ ...i, displayStatus: displayInvoiceStatus(i, today) })),
    meta: { ...pageMeta(q, total), totalAmount: sums._sum.total ?? '0', totalBalance: sums._sum.balanceDue ?? '0' },
  });
});

invoicesRouter.get('/:id', requirePermission('invoices:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, companyName: true, email: true } },
      subscription: { select: { id: true, number: true, status: true, plan: { select: { name: true } } } },
      discount: { select: { id: true, code: true, name: true, type: true, value: true } },
      lines: { orderBy: { sortOrder: 'asc' } },
      allocations: {
        orderBy: { createdAt: 'asc' },
        include: { payment: { select: { id: true, number: true, method: true, paymentDate: true, status: true, reference: true, amount: true } } },
      },
    },
  });
  if (!inv) throw notFound('Invoice');
  const today = await businessToday();
  const history = await prisma.auditLog.findMany({
    where: { entityType: 'Invoice', entityId: id },
    orderBy: { createdAt: 'desc' },
    include: { actor: { select: { name: true } } },
  });
  res.json({ data: { ...inv, displayStatus: displayInvoiceStatus(inv, today), history } });
});

const manualFields = z.object({
  customerId: z.string().uuid('Select a customer'),
  subscriptionId: optionalUuid,
  invoiceDate: dateString.optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(180).optional(),
  lines: z.array(lineInput).min(1, 'Add at least one line').max(100),
  discountId: optionalUuid,
  notes: optionalText(2000),
});

/** Manual (one-off) invoice, e.g. set-up fees or extra services. Prices come from the catalogue. */
invoicesRouter.post('/', requirePermission('invoices:write'), async (req, res) => {
  const body = parse(manualFields, req.body);
  const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
  if (!customer || customer.status !== 'ACTIVE') throw unprocessable('Select an active customer');
  let planId: string | null = null;
  if (body.subscriptionId) {
    const sub = await prisma.subscription.findUnique({ where: { id: body.subscriptionId } });
    if (!sub || sub.customerId !== body.customerId) throw unprocessable('Subscription does not belong to this customer');
    planId = sub.planId;
  }
  const settings = await getSettings();
  const invoiceDate = body.invoiceDate ? toDateOnly(body.invoiceDate) : await businessToday();
  const pricing = await priceDraft(prisma, {
    planId,
    lines: body.lines,
    date: invoiceDate,
    discountId: body.discountId,
    subscriptionId: body.subscriptionId,
    skipPlanChecks: true,
  });
  const address = [customer.addressLine1, customer.addressLine2, customer.city, customer.state, customer.postalCode, customer.country].filter(Boolean).join(', ');
  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        number: await nextNumber(tx, 'INV', invoiceDate.getUTCFullYear()),
        customerId: customer.id,
        subscriptionId: body.subscriptionId ?? null,
        source: 'MANUAL',
        status: 'DRAFT',
        invoiceDate,
        dueDate: addDays(invoiceDate, body.paymentTermsDays ?? settings.invoiceDueDays),
        currency: settings.currency,
        discountId: pricing.discount?.id ?? null,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        taxTotal: pricing.taxTotal,
        total: pricing.total,
        balanceDue: pricing.total,
        billToName: customer.companyName ? `${customer.companyName} (${customer.name})` : customer.name,
        billToEmail: customer.email,
        billToAddress: address || null,
        billToTaxId: customer.taxId,
        notes: body.notes ?? null,
        lines: {
          create: pricing.lines.map((l) => ({
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
          })),
        },
      },
    });
    if (pricing.discount) {
      // Manual invoices consume discount usage the same way recurring invoices do.
      const ok = await tx.$executeRaw`
        UPDATE "Discount" SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
        WHERE "id" = ${pricing.discount.id} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
      if (ok !== 1) throw unprocessable(`Discount ${pricing.discount.code} has reached its usage limit`);
      await tx.discountUsage.create({ data: { discountId: pricing.discount.id, customerId: customer.id, invoiceId: inv.id, amount: pricing.documentDiscount } });
    }
    await audit({ actorId: req.user!.id, action: 'INVOICE_CREATED', entityType: 'Invoice', entityId: inv.id, details: { total: pricing.total } }, tx);
    return inv;
  });
  res.status(201).json({ data: invoice });
});

invoicesRouter.patch('/:id', requirePermission('invoices:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ dueDate: dateString.optional(), notes: optionalText(2000) }), req.body);
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'DRAFT') throw unprocessable('Only draft invoices can be edited');
  const dueDate = body.dueDate ? toDateOnly(body.dueDate) : undefined;
  if (dueDate && dueDate < inv.invoiceDate) throw unprocessable('Due date cannot be before the invoice date');
  const updated = await prisma.invoice.update({ where: { id }, data: { dueDate, notes: body.notes } });
  await audit({ actorId: req.user!.id, action: 'INVOICE_UPDATED', entityType: 'Invoice', entityId: id, details: body });
  res.json({ data: updated });
});

invoicesRouter.post('/:id/confirm', requirePermission('invoices:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ sendEmail: z.boolean().default(false) }), req.body ?? {});
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'DRAFT') throw unprocessable('Only draft invoices can be confirmed');
  const zero = d(inv.total).eq(0);
  const updated = await prisma.invoice.update({
    where: { id },
    data: { status: zero ? 'PAID' : 'CONFIRMED', confirmedAt: new Date(), ...(zero ? { paidAt: new Date() } : {}) },
  });
  await audit({ actorId: req.user!.id, action: 'INVOICE_CONFIRMED', entityType: 'Invoice', entityId: id });
  let emailWarning: string | undefined;
  if (body.sendEmail) {
    try {
      await notifyInvoice(id);
    } catch {
      // The invoice IS confirmed; only the email failed. Report it without undoing the confirmation.
      emailWarning = 'Invoice confirmed, but the email could not be sent (mail server unreachable). Use “Email” to retry.';
    }
  }
  res.json({ data: updated, ...(emailWarning ? { emailWarning } : {}) });
});

invoicesRouter.post('/:id/cancel', requirePermission('invoices:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason for cancelling').max(500) }), req.body);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Invoice');
    if (!['DRAFT', 'CONFIRMED'].includes(inv.status)) {
      throw unprocessable('Only draft or unpaid confirmed invoices can be cancelled. Void the payments first.');
    }
    if (d(inv.amountPaid).gt(0)) throw unprocessable('This invoice has payments recorded. Void them before cancelling.');
    // Give back the discount usage so the cap reflects only live invoices.
    const usage = await tx.discountUsage.findFirst({ where: { invoiceId: id } });
    if (usage) {
      await tx.discountUsage.delete({ where: { id: usage.id } });
      await tx.$executeRaw`UPDATE "Discount" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${usage.discountId}`;
    }
    // NOTE: the billingPeriodKey is kept, so the cancelled period is not automatically re-billed.
    const u = await tx.invoice.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: body.reason, balanceDue: '0.00' },
    });
    await audit({ actorId: req.user!.id, action: 'INVOICE_CANCELLED', entityType: 'Invoice', entityId: id, details: { reason: body.reason } }, tx);
    return u;
  });
  res.json({ data: updated });
});

invoicesRouter.post('/:id/send', requirePermission('invoices:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') throw unprocessable('Confirm the invoice before sending it');
  await notifyInvoice(id);
  await audit({ actorId: req.user!.id, action: 'INVOICE_SENT', entityType: 'Invoice', entityId: id });
  res.json({ data: { message: `Invoice emailed to ${inv.billToEmail}` } });
});

invoicesRouter.get('/:id/pdf', requirePermission('invoices:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  if (!(await prisma.invoice.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Invoice');
  const { buffer, filename } = await invoicePdf(id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.send(buffer);
});
