import { prisma } from '../lib/prisma';
import { notFound, unprocessable } from '../lib/errors';
import { audit } from '../lib/audit';
import { businessToday } from '../lib/settings';
import { canTransitionQuotation } from '../domain/lifecycle';
import { formatDateOnly } from '../domain/dates';
import { createSubscription, recordEvent, subscriptionLineRows, totalsFrom } from './subscriptions';
import type { PricedLineRow } from './documentPricing';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

async function load(id: string) {
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw notFound('Quotation');
  return q;
}

export async function acceptQuotation(id: string, actorId: string | null, opts: { customerId?: string } = {}) {
  const q = await load(id);
  if (opts.customerId && q.customerId !== opts.customerId) throw notFound('Quotation');
  if (!canTransitionQuotation(q.status, 'ACCEPTED')) throw unprocessable(`A ${label(q.status)} quotation cannot be accepted`);
  const today = await businessToday();
  if (q.validUntil < today) {
    await prisma.quotation.update({ where: { id }, data: { status: 'EXPIRED' } });
    throw unprocessable('This quotation has expired. Ask Brightloop for a revised quotation.');
  }
  const updated = await prisma.quotation.update({ where: { id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
  await audit({ actorId, action: 'QUOTATION_ACCEPTED', entityType: 'Quotation', entityId: id, details: { by: opts.customerId ? 'customer' : 'staff' } });
  return updated;
}

export async function rejectQuotation(id: string, actorId: string | null, reason: string | null, opts: { customerId?: string } = {}) {
  const q = await load(id);
  if (opts.customerId && q.customerId !== opts.customerId) throw notFound('Quotation');
  if (!canTransitionQuotation(q.status, 'REJECTED')) throw unprocessable(`A ${label(q.status)} quotation cannot be rejected`);
  const updated = await prisma.quotation.update({ where: { id }, data: { status: 'REJECTED', respondedAt: new Date(), rejectionReason: reason } });
  if (q.subscriptionId) {
    await prisma.subscription.updateMany({ where: { id: q.subscriptionId, status: 'QUOTATION' }, data: { status: 'DRAFT' } });
  }
  await audit({ actorId, action: 'QUOTATION_REJECTED', entityType: 'Quotation', entityId: id, details: { reason } });
  return updated;
}

/**
 * Converts an ACCEPTED quotation into a CONFIRMED subscription, copying every line with its price,
 * discount and tax snapshot so nothing is lost or duplicated. A quotation raised from an existing draft
 * subscription confirms that subscription instead of creating a second one.
 */
export async function convertQuotation(
  id: string,
  actorId: string | null,
  args: { startDate?: Date; paymentTermsDays?: number } = {},
) {
  const today = await businessToday();
  return prisma.$transaction(async (tx) => {
    // Lock the quotation row so a double-click cannot convert twice.
    await tx.$queryRaw`SELECT "id" FROM "Quotation" WHERE "id" = ${id} FOR UPDATE`;
    const q = await tx.quotation.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!q) throw notFound('Quotation');
    if (q.status !== 'ACCEPTED') throw unprocessable('Only accepted quotations can be converted');
    if (!q.planId) throw unprocessable('The quotation has no plan');

    const rows: PricedLineRow[] = q.lines.map((l) => ({
      type: l.planId ? 'PLAN' : 'PRODUCT',
      planId: l.planId,
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
    const totals = { subtotal: q.subtotal.toFixed(2), discountTotal: q.discountTotal.toFixed(2), taxTotal: q.taxTotal.toFixed(2), total: q.total.toFixed(2) };

    let subscriptionId: string;
    if (q.subscriptionId) {
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: q.subscriptionId } });
      if (!['DRAFT', 'QUOTATION'].includes(sub.status)) throw unprocessable('The linked subscription is no longer a draft');
      await tx.subscriptionLine.deleteMany({ where: { subscriptionId: sub.id } });
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          planId: q.planId,
          discountId: q.discountId,
          ...totalsFrom(totals),
          lines: { create: subscriptionLineRows(rows) },
        },
      });
      await recordEvent(tx, sub.id, actorId, 'STATUS_CHANGED', `Quotation ${q.number} accepted — subscription confirmed`, sub.status, 'CONFIRMED');
      subscriptionId = sub.id;
    } else {
      const sub = await createSubscription(tx, {
        customerId: q.customerId,
        planId: q.planId,
        status: 'CONFIRMED',
        startDate: args.startDate ?? today,
        paymentTermsDays: args.paymentTermsDays,
        notes: q.notes,
        discountId: q.discountId,
        pricing: { ...totals, lines: rows },
        actorId,
      });
      await recordEvent(tx, sub.id, actorId, 'CREATED', `Created from quotation ${q.number} (sent ${q.sentAt ? formatDateOnly(q.sentAt) : '—'})`, null, 'QUOTATION');
      await recordEvent(tx, sub.id, actorId, 'STATUS_CHANGED', `Quotation ${q.number} accepted — subscription confirmed`, 'QUOTATION', 'CONFIRMED');
      subscriptionId = sub.id;
    }

    await tx.quotation.update({ where: { id }, data: { status: 'CONVERTED', subscriptionId } });
    await audit({ actorId, action: 'QUOTATION_CONVERTED', entityType: 'Quotation', entityId: id, details: { subscriptionId } }, tx);
    return tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  });
}
