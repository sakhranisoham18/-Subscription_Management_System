import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateString, idParam, money, optionalText, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { nextNumber } from '../../lib/sequence';
import { businessToday } from '../../lib/settings';
import { requirePermission } from '../../middleware/auth';
import { toDateOnly } from '../../domain/dates';
import { applyToInvoice, validateAllocations } from '../../domain/payments';
import { invoiceStatusFromPayments } from '../../domain/lifecycle';
import { round2, toMoneyString } from '../../domain/money';

export const paymentsRouter = Router();

const METHODS = ['BANK_TRANSFER', 'CARD', 'CASH', 'UPI', 'CHEQUE', 'OTHER'] as const;

export function paymentWhere(q: {
  method?: (typeof METHODS)[number];
  status?: 'COMPLETED' | 'VOIDED';
  customerId?: string;
  invoiceId?: string;
  from?: string;
  to?: string;
  search?: string;
}): Prisma.PaymentWhereInput {
  return {
    method: q.method,
    status: q.status,
    customerId: q.customerId,
    ...(q.invoiceId ? { allocations: { some: { invoiceId: q.invoiceId } } } : {}),
    ...(q.from || q.to
      ? { paymentDate: { ...(q.from ? { gte: toDateOnly(q.from) } : {}), ...(q.to ? { lte: toDateOnly(q.to) } : {}) } }
      : {}),
    ...(q.search
      ? {
          OR: [
            { number: { contains: q.search, mode: 'insensitive' } },
            { reference: { contains: q.search, mode: 'insensitive' } },
            { customer: { name: { contains: q.search, mode: 'insensitive' } } },
            { customer: { companyName: { contains: q.search, mode: 'insensitive' } } },
            { allocations: { some: { invoice: { number: { contains: q.search, mode: 'insensitive' } } } } },
          ],
        }
      : {}),
  };
}

const listQuery = paginationQuery.extend({
  method: z.enum(METHODS).optional(),
  status: z.enum(['COMPLETED', 'VOIDED']).optional(),
  customerId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

/** Reconciliation-friendly list: filter by date, method, customer, invoice and status. */
paymentsRouter.get('/', requirePermission('payments:read'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const where = paymentWhere(q);
  const [total, items, sum, byMethod] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: orderBy(q, ['number', 'paymentDate', 'amount', 'createdAt'] as const, 'paymentDate'),
      ...pageArgs(q),
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
        allocations: { include: { invoice: { select: { id: true, number: true } } } },
        recordedBy: { select: { name: true } },
      },
    }),
    prisma.payment.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['method'], where: { ...where, status: 'COMPLETED' }, _sum: { amount: true }, _count: true }),
  ]);
  res.json({
    data: items,
    meta: {
      ...pageMeta(q, total),
      totalAmount: toMoneyString(sum._sum.amount ?? 0),
      byMethod: byMethod.map((m) => ({ method: m.method, count: m._count, amount: toMoneyString(m._sum.amount ?? 0) })),
    },
  });
});

paymentsRouter.get('/:id', requirePermission('payments:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const p = await prisma.payment.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, companyName: true, email: true } },
      allocations: { include: { invoice: { select: { id: true, number: true, total: true, balanceDue: true, status: true } } } },
      recordedBy: { select: { name: true } },
    },
  });
  if (!p) throw notFound('Payment');
  const history = await prisma.auditLog.findMany({ where: { entityType: 'Payment', entityId: id }, orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true } } } });
  res.json({ data: { ...p, history } });
});

/**
 * Records a manual payment (bank transfer, card, cash, UPI, cheque…) and allocates it to one or more
 * invoices in a single transaction. Invoice rows are locked, balances re-validated inside the
 * transaction (no over-allocation, even under concurrency) and statuses recalculated.
 * No card is charged — this system does not integrate a payment gateway.
 */
paymentsRouter.post('/', requirePermission('payments:write'), async (req, res) => {
  const body = parse(
    z.object({
      customerId: z.string().uuid('Select a customer'),
      method: z.enum(METHODS),
      amount: money,
      paymentDate: dateString,
      reference: optionalText(80),
      notes: optionalText(1000),
      allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: money })).min(1, 'Allocate the payment to an invoice').max(50),
    }),
    req.body,
  );
  const paymentDate = toDateOnly(body.paymentDate);
  if (paymentDate > (await businessToday())) throw unprocessable('Payment date cannot be in the future');
  if (body.reference && (await prisma.payment.findUnique({ where: { reference: body.reference } }))) {
    throw conflict('A payment with this reference has already been recorded', { fields: { reference: 'Duplicate reference' } });
  }

  const payment = await prisma.$transaction(async (tx) => {
    const ids = body.allocations.map((a) => a.invoiceId);
    // Lock the invoices being paid (ordered to avoid deadlocks).
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
    const invoices = await tx.invoice.findMany({ where: { id: { in: ids } } });
    const problems = validateAllocations(body.amount, body.customerId, body.allocations, invoices);
    if (problems.length) throw unprocessable(problems[0], { problems });

    const created = await tx.payment.create({
      data: {
        number: await nextNumber(tx, 'PAY', paymentDate.getUTCFullYear()),
        customerId: body.customerId,
        method: body.method,
        amount: toMoneyString(body.amount),
        paymentDate,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        recordedById: req.user!.id,
        allocations: { create: body.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: toMoneyString(a.amount) })) },
      },
    });
    for (const a of body.allocations) {
      const inv = invoices.find((i) => i.id === a.invoiceId)!;
      const next = applyToInvoice(inv.total, inv.amountPaid, round2(a.amount));
      const status = invoiceStatusFromPayments(inv.total, next.amountPaid);
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: toMoneyString(next.amountPaid),
          balanceDue: toMoneyString(next.balanceDue),
          status,
          paidAt: status === 'PAID' ? new Date() : null,
        },
      });
      await audit({ actorId: req.user!.id, action: 'PAYMENT_APPLIED', entityType: 'Invoice', entityId: inv.id, details: { payment: created.number, amount: toMoneyString(a.amount), status } }, tx);
    }
    await audit({ actorId: req.user!.id, action: 'PAYMENT_RECORDED', entityType: 'Payment', entityId: created.id, details: { amount: body.amount, method: body.method } }, tx);
    return created;
  });
  res.status(201).json({ data: payment });
});

/** Voids an erroneous payment: allocations are reversed and invoice balances/statuses restored. Admin only. */
paymentsRouter.post('/:id/void', requirePermission('payments:void'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) }), req.body);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${id} FOR UPDATE`;
    const p = await tx.payment.findUnique({ where: { id }, include: { allocations: true } });
    if (!p) throw notFound('Payment');
    if (p.status === 'VOIDED') throw unprocessable('Payment is already voided');
    const invoiceIds = p.allocations.map((a) => a.invoiceId);
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ANY(${invoiceIds}::text[]) ORDER BY "id" FOR UPDATE`;
    for (const a of p.allocations) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      const next = applyToInvoice(inv.total, inv.amountPaid, round2(a.amount).neg());
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: toMoneyString(next.amountPaid),
          balanceDue: toMoneyString(next.balanceDue),
          status: invoiceStatusFromPayments(inv.total, next.amountPaid),
          paidAt: null,
        },
      });
      await audit({ actorId: req.user!.id, action: 'PAYMENT_REVERSED', entityType: 'Invoice', entityId: inv.id, details: { payment: p.number, amount: toMoneyString(a.amount) } }, tx);
    }
    const voided = await tx.payment.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: body.reason } });
    await audit({ actorId: req.user!.id, action: 'PAYMENT_VOIDED', entityType: 'Payment', entityId: id, details: { reason: body.reason } }, tx);
    return voided;
  });
  res.json({ data: result });
});
