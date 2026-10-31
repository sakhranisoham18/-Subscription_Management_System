import type { CloseReason, Prisma, Subscription, SubscriptionStatus } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { notFound, unprocessable } from '../lib/errors';
import { audit } from '../lib/audit';
import { nextNumber } from '../lib/sequence';
import { businessToday, getSettings } from '../lib/settings';
import { canTransitionSubscription } from '../domain/lifecycle';
import { addBillingPeriods, addDays, formatDateOnly, type Frequency } from '../domain/dates';
import type { PricedLineRow, PricingResult } from './documentPricing';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function subscriptionLineRows(rows: PricedLineRow[]) {
  return rows.map((l) => ({
    productId: l.productId,
    variantId: l.variantId,
    isPlanFee: l.type === 'PLAN',
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
}

export const totalsFrom = (p: Pick<PricingResult, 'subtotal' | 'discountTotal' | 'taxTotal' | 'total'>) => ({
  subtotal: p.subtotal,
  discountTotal: p.discountTotal,
  taxTotal: p.taxTotal,
  total: p.total,
});

/** End date of a term of `periods` billing periods that starts on `start` (inclusive end). */
export function termEnd(start: Date, frequency: Frequency, interval: number, anchorDay: number, periods: number) {
  return addDays(addBillingPeriods(start, frequency, interval, anchorDay, periods), -1);
}

export async function recordEvent(
  tx: Tx,
  subscriptionId: string,
  actorId: string | null,
  type: string,
  message: string,
  from?: SubscriptionStatus | null,
  to?: SubscriptionStatus | null,
) {
  await tx.subscriptionEvent.create({
    data: { subscriptionId, actorId, type, message, fromStatus: from ?? null, toStatus: to ?? null },
  });
}

function assertTransition(sub: Subscription, to: SubscriptionStatus) {
  if (!canTransitionSubscription(sub.status, to)) {
    throw unprocessable(`A ${label(sub.status)} subscription cannot be moved to ${label(to)}`);
  }
}

async function load(id: string, tx: Tx = prisma) {
  const sub = await tx.subscription.findUnique({ where: { id }, include: { plan: true } });
  if (!sub) throw notFound('Subscription');
  return sub;
}

/** Creates a subscription record (used by "new subscription" and by quotation conversion). */
export async function createSubscription(
  tx: Tx,
  args: {
    customerId: string;
    planId: string;
    status: 'DRAFT' | 'CONFIRMED';
    startDate: Date;
    endDate?: Date | null;
    paymentTermsDays?: number;
    notes?: string | null;
    discountId?: string | null;
    autoRenew?: boolean;
    autoClose?: boolean;
    pricing: Pick<PricingResult, 'subtotal' | 'discountTotal' | 'taxTotal' | 'total'> & { lines: PricedLineRow[] };
    actorId: string | null;
  },
) {
  const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { id: args.planId } });
  const customer = await tx.customer.findUnique({ where: { id: args.customerId } });
  if (!customer || customer.status !== 'ACTIVE') throw unprocessable('Customer is not active');
  const settings = await getSettings();
  const anchorDay = args.startDate.getUTCDate();
  const endDate =
    args.endDate !== undefined && args.endDate !== null
      ? args.endDate
      : plan.termLength
        ? termEnd(args.startDate, plan.billingFrequency, plan.billingInterval, anchorDay, plan.termLength)
        : null;
  if (endDate && endDate < args.startDate) throw unprocessable('End date cannot be before the start date');

  const number = await nextNumber(tx, 'SUB');
  return tx.subscription.create({
    data: {
      number,
      customerId: args.customerId,
      planId: plan.id,
      status: args.status,
      startDate: args.startDate,
      endDate,
      billingFrequency: plan.billingFrequency,
      billingInterval: plan.billingInterval,
      billingAnchorDay: anchorDay,
      paymentTermsDays: args.paymentTermsDays ?? settings.invoiceDueDays,
      autoRenew: args.autoRenew ?? plan.autoRenew,
      autoClose: args.autoClose ?? plan.autoClose,
      currency: plan.currency,
      discountId: args.discountId ?? null,
      notes: args.notes ?? null,
      confirmedAt: args.status === 'CONFIRMED' ? new Date() : null,
      createdById: args.actorId,
      ...totalsFrom(args.pricing),
      lines: { create: subscriptionLineRows(args.pricing.lines) },
    },
  });
}

// ───────────────────────── Lifecycle actions ─────────────────────────

export async function confirmSubscription(id: string, actorId: string | null) {
  return prisma.$transaction(async (tx) => {
    const sub = await load(id, tx);
    assertTransition(sub, 'CONFIRMED');
    const updated = await tx.subscription.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    // a linked quotation that was still open is considered accepted and converted
    await tx.quotation.updateMany({
      where: { subscriptionId: id, status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] } },
      data: { status: 'CONVERTED', respondedAt: new Date() },
    });
    await recordEvent(tx, id, actorId, 'STATUS_CHANGED', 'Subscription confirmed', sub.status, 'CONFIRMED');
    await audit({ actorId, action: 'SUBSCRIPTION_CONFIRMED', entityType: 'Subscription', entityId: id }, tx);
    return updated;
  });
}

/** Activation sets the first billing date to the start date (billing in advance, catch-up if backdated). */
export async function activateSubscription(id: string, actorId: string | null) {
  return prisma.$transaction(async (tx) => {
    const sub = await load(id, tx);
    assertTransition(sub, 'ACTIVE');
    if (sub.status !== 'CONFIRMED') throw unprocessable('Only confirmed subscriptions can be activated');
    const lines = await tx.subscriptionLine.count({ where: { subscriptionId: id } });
    if (!lines) throw unprocessable('Add at least one line before activating');
    const updated = await tx.subscription.update({
      where: { id },
      data: { status: 'ACTIVE', activatedAt: new Date(), nextBillingDate: sub.startDate },
    });
    await recordEvent(tx, id, actorId, 'STATUS_CHANGED', `Subscription activated; first billing date ${formatDateOnly(sub.startDate)}`, sub.status, 'ACTIVE');
    await audit({ actorId, action: 'SUBSCRIPTION_ACTIVATED', entityType: 'Subscription', entityId: id }, tx);
    return updated;
  });
}

export async function pauseSubscription(id: string, actorId: string | null, reason?: string | null) {
  return prisma.$transaction(async (tx) => {
    const sub = await load(id, tx);
    assertTransition(sub, 'PAUSED');
    if (!sub.plan.allowPause) throw unprocessable(`Plan "${sub.plan.name}" does not allow pausing`);
    const updated = await tx.subscription.update({ where: { id }, data: { status: 'PAUSED', pausedAt: new Date() } });
    await recordEvent(tx, id, actorId, 'STATUS_CHANGED', `Subscription paused${reason ? `: ${reason}` : ''}`, sub.status, 'PAUSED');
    await audit({ actorId, action: 'SUBSCRIPTION_PAUSED', entityType: 'Subscription', entityId: id, details: { reason: reason ?? null } }, tx);
    return updated;
  });
}

/**
 * Resume policy: periods that fell inside the pause are not billed. If the next billing date passed
 * during the pause, billing restarts on the resume date and the cycle is re-anchored to that day.
 */
export async function resumeSubscription(id: string, actorId: string | null) {
  const today = await businessToday();
  return prisma.$transaction(async (tx) => {
    const sub = await load(id, tx);
    if (sub.status !== 'PAUSED') throw unprocessable('Only paused subscriptions can be resumed');
    const rebase = !sub.nextBillingDate || sub.nextBillingDate < today;
    const updated = await tx.subscription.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        pausedAt: null,
        ...(rebase ? { nextBillingDate: today, billingAnchorDay: today.getUTCDate() } : {}),
      },
    });
    await recordEvent(
      tx,
      id,
      actorId,
      'STATUS_CHANGED',
      `Subscription resumed; next billing ${formatDateOnly(updated.nextBillingDate ?? today)}`,
      'PAUSED',
      'ACTIVE',
    );
    await audit({ actorId, action: 'SUBSCRIPTION_RESUMED', entityType: 'Subscription', entityId: id }, tx);
    return updated;
  });
}

export async function closeSubscription(id: string, actorId: string | null, reason?: string | null, opts: { force?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const sub = await load(id, tx);
    assertTransition(sub, 'CLOSED');
    const running = sub.status === 'ACTIVE' || sub.status === 'PAUSED';
    if (running && !sub.plan.allowEarlyClose && !opts.force) {
      throw unprocessable(`Plan "${sub.plan.name}" does not allow closing early; it closes at the end of its term`);
    }
    const closeReason: CloseReason = running ? 'CLOSED_EARLY' : 'CANCELLED';
    const updated = await tx.subscription.update({
      where: { id },
      data: { status: 'CLOSED', closeReason, closedAt: new Date(), nextBillingDate: null },
    });
    await tx.quotation.updateMany({ where: { subscriptionId: id, status: { in: ['DRAFT', 'SENT'] } }, data: { status: 'REJECTED', rejectionReason: 'Subscription cancelled' } });
    await recordEvent(
      tx,
      id,
      actorId,
      'STATUS_CHANGED',
      `${running ? 'Closed early' : 'Cancelled'}${reason ? `: ${reason}` : ''}`,
      sub.status,
      'CLOSED',
    );
    await audit({ actorId, action: 'SUBSCRIPTION_CLOSED', entityType: 'Subscription', entityId: id, details: { reason: reason ?? null, closeReason } }, tx);
    return updated;
  });
}

/**
 * Renew:
 *  - Active/Paused with an end date → end date extended by N periods (default: plan term length or 1)
 *  - Closed because it expired/was not renewed → reopened as Active for a new term starting today
 */
export async function renewSubscription(id: string, actorId: string | null, periods?: number) {
  const today = await businessToday();
  return prisma.$transaction(async (tx) => {
    const sub = await load(id, tx);
    if (!sub.plan.allowRenew) throw unprocessable(`Plan "${sub.plan.name}" does not allow renewal`);
    const n = periods ?? sub.plan.termLength ?? 1;
    const freq = sub.billingFrequency as Frequency;
    let data: Prisma.SubscriptionUpdateInput;
    let message: string;
    if (sub.status === 'ACTIVE' || sub.status === 'PAUSED') {
      if (!sub.endDate) throw unprocessable('This subscription has no end date, so it does not need renewing');
      const newEnd = termEnd(addDays(sub.endDate, 1), freq, sub.billingInterval, sub.billingAnchorDay, n);
      data = { endDate: newEnd };
      message = `Renewed for ${n} period(s) until ${formatDateOnly(newEnd)}`;
    } else if (sub.status === 'CLOSED' && (sub.closeReason === 'EXPIRED' || sub.closeReason === 'NOT_RENEWED')) {
      const newEnd = termEnd(today, freq, sub.billingInterval, today.getUTCDate(), n);
      data = {
        status: 'ACTIVE',
        closeReason: null,
        closedAt: null,
        endDate: newEnd,
        nextBillingDate: today,
        billingAnchorDay: today.getUTCDate(),
      };
      message = `Reactivated and renewed until ${formatDateOnly(newEnd)}`;
    } else {
      throw unprocessable(`A ${label(sub.status)} subscription cannot be renewed`);
    }
    const updated = await tx.subscription.update({ where: { id }, data });
    await recordEvent(tx, id, actorId, 'RENEWED', message, sub.status, updated.status);
    await audit({ actorId, action: 'SUBSCRIPTION_RENEWED', entityType: 'Subscription', entityId: id, details: { periods: n } }, tx);
    return updated;
  });
}

/** Upcoming billing schedule (next N dates, stopping at the end date). */
export function upcomingSchedule(
  sub: Pick<Subscription, 'status' | 'nextBillingDate' | 'endDate' | 'billingFrequency' | 'billingInterval' | 'billingAnchorDay'>,
  count = 6,
) {
  const dates: string[] = [];
  if (!['ACTIVE', 'PAUSED'].includes(sub.status) || !sub.nextBillingDate) return dates;
  let cursor = sub.nextBillingDate;
  while (dates.length < count && (!sub.endDate || cursor <= sub.endDate)) {
    dates.push(formatDateOnly(cursor));
    cursor = addBillingPeriods(cursor, sub.billingFrequency as Frequency, sub.billingInterval, sub.billingAnchorDay);
  }
  return dates;
}
