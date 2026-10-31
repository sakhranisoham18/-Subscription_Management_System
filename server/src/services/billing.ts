import type { BillingTrigger, Discount, Prisma, Subscription, SubscriptionLine, TaxRule } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { conflict } from '../lib/errors';
import { nextNumber } from '../lib/sequence';
import { audit } from '../lib/audit';
import { getSettings, businessToday } from '../lib/settings';
import { addBillingPeriods, addDays, billingPeriod, formatDateOnly, type Frequency } from '../domain/dates';
import { evaluateDiscount } from '../domain/discounts';
import { priceDocument } from '../domain/pricing';
import { d, toMoneyString } from '../domain/money';
import { toDiscountRule } from './documentPricing';
import { notifyInvoice } from './notifications';

const LOCK_KEY = 'billing_run_lock';
const LOCK_STALE_MINUTES = 30;
/** Safety cap on catch-up periods per subscription per run (remaining periods are billed on the next run). */
const MAX_PERIODS_PER_RUN = 60;

type SubWithLines = Subscription & { lines: (SubscriptionLine & { taxRule: TaxRule | null })[] };

export const billingKey = (subscriptionId: string, periodStart: Date) => `${subscriptionId}:${formatDateOnly(periodStart)}`;

/** Where-clause for subscriptions that are due for billing on `asOf`. */
export function dueWhere(asOf: Date): Prisma.SubscriptionWhereInput {
  return {
    status: 'ACTIVE',
    nextBillingDate: { lte: asOf },
    OR: [{ endDate: null }, { endDate: { gte: prisma.subscription.fields.nextBillingDate } }],
  };
}

/** Number of billing periods due for a subscription on `asOf` (respecting its end date). */
export function countDuePeriods(sub: Pick<Subscription, 'nextBillingDate' | 'endDate' | 'billingFrequency' | 'billingInterval' | 'billingAnchorDay'>, asOf: Date, cap = 1000) {
  let n = 0;
  let cursor = sub.nextBillingDate;
  while (cursor && cursor <= asOf && (!sub.endDate || cursor <= sub.endDate) && n < cap) {
    n += 1;
    cursor = addBillingPeriods(cursor, sub.billingFrequency as Frequency, sub.billingInterval, sub.billingAnchorDay);
  }
  return n;
}

// ───────────────────────── Invoice construction ─────────────────────────

function lineInputs(sub: SubWithLines) {
  // Current tax rate from the admin-managed rule (falls back to the stored snapshot if the rule was archived).
  return sub.lines
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({
      line: l,
      taxRate: l.taxRule && l.taxRule.status === 'ACTIVE' ? d(l.taxRule.rate) : d(l.taxRate),
    }));
}

async function candidateDiscounts(tx: Tx, sub: SubWithLines, date: Date) {
  const where: Prisma.DiscountWhereInput = {
    status: 'ACTIVE',
    startsAt: { lte: date },
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: date } }] }],
    OR: [{ autoApply: true }, ...(sub.discountId ? [{ id: sub.discountId }] : [])],
  };
  return tx.discount.findMany({ where });
}

/**
 * Builds and persists one recurring invoice for `periodStart` inside the given transaction.
 * Discounts: the eligible discount with the largest saving is applied; its usage counter is incremented
 * with a conditional UPDATE so concurrent runs can never exceed the usage limit.
 */
async function createRecurringInvoice(tx: Tx, sub: SubWithLines, periodStart: Date, invoiceDate: Date, autoConfirm: boolean) {
  const customer = await tx.customer.findUniqueOrThrow({ where: { id: sub.customerId } });
  const inputs = lineInputs(sub);
  if (!inputs.length) throw new Error('Subscription has no lines to bill');

  const ctxLines = inputs.map(({ line }) => {
    const gross = d(line.unitPrice).mul(line.quantity);
    return {
      productId: line.productId,
      quantity: line.quantity,
      netAmount: gross.minus(gross.mul(d(line.discountPercent)).div(100)).toDecimalPlaces(2),
    };
  });
  const ctx = { date: invoiceDate, planId: sub.planId, subscriptionId: sub.id, lines: ctxLines };

  const evaluated = (await candidateDiscounts(tx, sub, invoiceDate))
    .map((rule) => ({ rule, result: evaluateDiscount(toDiscountRule(rule), ctx) }))
    .filter((x): x is { rule: Discount; result: Extract<ReturnType<typeof evaluateDiscount>, { eligible: true }> } => x.result.eligible)
    .sort((a, b) => b.result.amount.comparedTo(a.result.amount));

  let applied: (typeof evaluated)[number] | null = null;
  for (const candidate of evaluated) {
    const updated = await tx.$executeRaw`
      UPDATE "Discount" SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
      WHERE "id" = ${candidate.rule.id} AND "status" = 'ACTIVE'
        AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
    if (updated === 1) {
      applied = candidate;
      break;
    }
  }

  const priced = priceDocument(
    inputs.map(({ line, taxRate }, i) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      taxRate,
      discountEligible: applied ? applied.result.eligibleLineIndexes.includes(i) : false,
    })),
    applied ? { type: applied.rule.type, value: applied.rule.value } : null,
  );

  const { periodEnd } = billingPeriod(periodStart, sub.billingFrequency as Frequency, sub.billingInterval, sub.billingAnchorDay);
  const number = await nextNumber(tx, 'INV', invoiceDate.getUTCFullYear());
  const total = priced.total;
  const status = autoConfirm ? (total.eq(0) ? 'PAID' : 'CONFIRMED') : 'DRAFT';
  const address = [customer.addressLine1, customer.addressLine2, customer.city, customer.state, customer.postalCode, customer.country]
    .filter(Boolean)
    .join(', ');

  const invoice = await tx.invoice.create({
    data: {
      number,
      customerId: sub.customerId,
      subscriptionId: sub.id,
      source: 'RECURRING',
      status,
      invoiceDate,
      dueDate: addDays(invoiceDate, sub.paymentTermsDays),
      periodStart,
      periodEnd,
      billingPeriodKey: billingKey(sub.id, periodStart),
      currency: sub.currency,
      discountId: applied?.rule.id ?? null,
      subtotal: toMoneyString(priced.subtotal),
      discountTotal: toMoneyString(priced.discountTotal),
      taxTotal: toMoneyString(priced.taxTotal),
      total: toMoneyString(total),
      amountPaid: '0.00',
      balanceDue: toMoneyString(total),
      billToName: customer.companyName ? `${customer.companyName} (${customer.name})` : customer.name,
      billToEmail: customer.email,
      billToAddress: address || null,
      billToTaxId: customer.taxId,
      confirmedAt: autoConfirm ? new Date() : null,
      paidAt: status === 'PAID' ? new Date() : null,
      notes: `Subscription ${sub.number} · service period ${formatDateOnly(periodStart)} to ${formatDateOnly(periodEnd)}`,
      lines: {
        create: inputs.map(({ line }, i) => ({
          productId: line.productId,
          variantId: line.variantId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: toMoneyString(line.unitPrice),
          discountPercent: d(line.discountPercent).toFixed(4),
          taxRuleId: line.taxRuleId,
          taxRate: priced.lines[i].taxRate.toFixed(4),
          lineSubtotal: toMoneyString(priced.lines[i].lineSubtotal),
          discountAmount: toMoneyString(priced.lines[i].discountAmount),
          taxAmount: toMoneyString(priced.lines[i].taxAmount),
          lineTotal: toMoneyString(priced.lines[i].lineTotal),
          sortOrder: i,
        })),
      },
    },
  });

  if (applied) {
    await tx.discountUsage.create({
      data: { discountId: applied.rule.id, customerId: sub.customerId, invoiceId: invoice.id, amount: toMoneyString(priced.documentDiscount) },
    });
  }
  return invoice;
}

/**
 * Bills ONE period of a subscription atomically:
 *   lock row → verify still due → (idempotency check) → create invoice → advance next billing date.
 * If anything throws, the transaction rolls back and the next billing date is NOT advanced.
 */
async function billOnePeriod(subscriptionId: string, asOf: Date, autoConfirm: boolean, runId: string | null, actorId: string | null) {
  return prisma.$transaction(
    async (tx) => {
      // Row lock: concurrent runs serialise on the subscription.
      await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${subscriptionId} FOR UPDATE`;
      const sub = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { lines: { include: { taxRule: true } } },
      });
      if (sub.status !== 'ACTIVE' || !sub.nextBillingDate || sub.nextBillingDate > asOf) return { kind: 'not-due' as const };
      if (sub.endDate && sub.nextBillingDate > sub.endDate) return { kind: 'not-due' as const };

      const periodStart = sub.nextBillingDate;
      const nextDate = addBillingPeriods(periodStart, sub.billingFrequency as Frequency, sub.billingInterval, sub.billingAnchorDay);
      const key = billingKey(sub.id, periodStart);
      const existing = await tx.invoice.findUnique({ where: { billingPeriodKey: key }, select: { id: true, number: true } });

      if (existing) {
        // Period already invoiced (e.g. interrupted earlier run) — never bill twice, just move the schedule forward.
        await tx.subscription.update({ where: { id: sub.id }, data: { nextBillingDate: nextDate } });
        if (runId) {
          await tx.billingEvent.create({
            data: { runId, subscriptionId: sub.id, invoiceId: existing.id, periodStart, status: 'SKIPPED', message: `Period already invoiced (${existing.number})` },
          });
        }
        return { kind: 'skipped' as const, invoiceId: existing.id };
      }

      const invoice = await createRecurringInvoice(tx, sub, periodStart, asOf, autoConfirm);
      await tx.subscription.update({ where: { id: sub.id }, data: { nextBillingDate: nextDate } });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          actorId,
          type: 'INVOICED',
          message: `Invoice ${invoice.number} generated for period starting ${formatDateOnly(periodStart)}; next billing ${formatDateOnly(nextDate)}`,
        },
      });
      if (runId) {
        await tx.billingEvent.create({
          data: { runId, subscriptionId: sub.id, invoiceId: invoice.id, periodStart, status: 'INVOICED', message: invoice.number },
        });
      }
      return { kind: 'invoiced' as const, invoice };
    },
    { timeout: 20_000 },
  );
}

// ───────────────────────── Term end: auto-renew / auto-close ─────────────────────────

/**
 * Subscriptions whose end date has passed:
 *   autoRenew → extend by one term (plan.termLength periods)
 *   autoClose → close with reason EXPIRED
 *   neither   → left as is (no further billing because the end date has passed) for staff to decide.
 */
export async function processExpirations(today: Date, actorId: string | null = null) {
  const expired = await prisma.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'PAUSED'] }, endDate: { lt: today } },
    include: { plan: { select: { termLength: true, allowRenew: true } } },
    take: 1000,
  });
  let renewed = 0;
  let closed = 0;
  for (const sub of expired) {
    if (!sub.endDate) continue;
    if (sub.autoRenew && sub.plan.allowRenew && sub.status === 'ACTIVE') {
      const periods = sub.plan.termLength ?? 1;
      let newEnd = sub.endDate;
      // extend until the term covers today (handles long gaps without skipping periods)
      while (newEnd < today) {
        newEnd = addDays(addBillingPeriods(addDays(newEnd, 1), sub.billingFrequency as Frequency, sub.billingInterval, sub.billingAnchorDay, periods), -1);
      }
      await prisma.$transaction([
        prisma.subscription.update({ where: { id: sub.id }, data: { endDate: newEnd } }),
        prisma.subscriptionEvent.create({
          data: { subscriptionId: sub.id, actorId, type: 'RENEWED', message: `Automatically renewed until ${formatDateOnly(newEnd)}` },
        }),
      ]);
      renewed += 1;
    } else if (sub.autoClose) {
      await prisma.$transaction([
        prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'CLOSED', closeReason: 'EXPIRED', closedAt: new Date(), nextBillingDate: null },
        }),
        prisma.subscriptionEvent.create({
          data: { subscriptionId: sub.id, actorId, type: 'STATUS_CHANGED', fromStatus: sub.status, toStatus: 'CLOSED', message: `Closed automatically at the end of its term (${formatDateOnly(sub.endDate)})` },
        }),
      ]);
      closed += 1;
    }
  }
  // Quotations past their validity become EXPIRED.
  const expiredQuotes = await prisma.quotation.updateMany({ where: { status: 'SENT', validUntil: { lt: today } }, data: { status: 'EXPIRED' } });
  return { renewed, closed, quotationsExpired: expiredQuotes.count };
}

// ───────────────────────── Run orchestration ─────────────────────────

async function acquireLock(runId: string): Promise<boolean> {
  await prisma.$executeRaw`INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES (${LOCK_KEY}, '', NOW()) ON CONFLICT ("key") DO NOTHING`;
  const updated = await prisma.$executeRaw`
    UPDATE "Setting" SET "value" = ${runId}, "updatedAt" = NOW()
    WHERE "key" = ${LOCK_KEY} AND ("value" = '' OR "updatedAt" < NOW() - make_interval(mins => ${LOCK_STALE_MINUTES}::int))`;
  return updated === 1;
}

async function releaseLock(runId: string) {
  await prisma.$executeRaw`UPDATE "Setting" SET "value" = '', "updatedAt" = NOW() WHERE "key" = ${LOCK_KEY} AND "value" = ${runId}`;
}

export interface RunOptions {
  trigger: BillingTrigger;
  actorId?: string | null;
  asOf?: Date;
  batchSize?: number;
}

/**
 * Recurring billing run. Safe to retry and to run concurrently:
 *   - a lock row stops two runs overlapping (a stale lock expires after 30 minutes)
 *   - each period is billed in its own transaction with a row lock
 *   - the unique billingPeriodKey makes a duplicate invoice impossible at the database level
 *   - subscriptions are processed in bounded batches (cursor pagination by id)
 *   - all overdue periods are billed in order (catch-up) — none are skipped
 */
export async function runBilling(opts: RunOptions) {
  const asOf = opts.asOf ?? (await businessToday());
  const settings = await getSettings();
  const batchSize = opts.batchSize ?? env.BILLING_BATCH_SIZE;
  const actorId = opts.actorId ?? null;

  const run = await prisma.billingJobRun.create({ data: { trigger: opts.trigger, triggeredById: actorId, asOfDate: asOf } });
  if (!(await acquireLock(run.id))) {
    // Lock contention is normal when several instances share a schedule — it is not a failed run, so don't record one
    // (a FAILED row would make the dashboard report a false billing failure).
    await prisma.billingJobRun.delete({ where: { id: run.id } });
    logger.info({ trigger: opts.trigger }, 'Billing run skipped: another run is in progress');
    throw conflict('Another billing run is already in progress. Please wait for it to finish.');
  }

  let processed = 0;
  let created = 0;
  let failures = 0;
  let skipped = 0;
  const errors: string[] = [];
  const toNotify: string[] = [];
  try {
    await processExpirations(asOf, actorId);
    let cursor: string | undefined;
    for (;;) {
      // Keyset pagination on id. NOTE: do not use Prisma's `cursor` + `skip: 1` here — the cursor row has just been billed, so it no
      // longer matches the "due" filter and skip:1 would silently drop the next due subscription at every batch boundary.
      const batch = await prisma.subscription.findMany({
        where: cursor ? { AND: [dueWhere(asOf), { id: { gt: cursor } }] } : dueWhere(asOf),
        select: { id: true, number: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
      if (!batch.length) break;
      cursor = batch[batch.length - 1].id;

      for (const sub of batch) {
        processed += 1;
        for (let i = 0; i < MAX_PERIODS_PER_RUN; i += 1) {
          try {
            const result = await billOnePeriod(sub.id, asOf, settings.autoConfirmRecurringInvoices, run.id, actorId);
            if (result.kind === 'not-due') break;
            if (result.kind === 'skipped') skipped += 1;
            if (result.kind === 'invoiced') {
              created += 1;
              if (result.invoice.status === 'CONFIRMED') toNotify.push(result.invoice.id);
            }
          } catch (err) {
            failures += 1;
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`${sub.number}: ${message}`);
            logger.error({ err, subscriptionId: sub.id }, 'Billing failed for subscription');
            await prisma.billingEvent
              .create({ data: { runId: run.id, subscriptionId: sub.id, status: 'FAILED', message: message.slice(0, 500) } })
              .catch(() => undefined);
            break; // do not advance; retry on next run
          }
        }
      }
      if (batch.length < batchSize) break;
    }
  } finally {
    const status = failures === 0 ? 'SUCCESS' : created > 0 || skipped > 0 ? 'PARTIAL' : 'FAILED';
    await prisma.billingJobRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        subscriptionsProcessed: processed,
        invoicesCreated: created,
        failures,
        skipped,
        errorSummary: errors.length ? errors.slice(0, 20).join('\n') : null,
      },
    });
    await releaseLock(run.id);
  }

  await audit({
    actorId,
    action: 'BILLING_RUN',
    entityType: 'BillingJobRun',
    entityId: run.id,
    details: { trigger: opts.trigger, asOf: formatDateOnly(asOf), processed, created, failures, skipped },
  });

  // Notifications are sent after the financial work is committed; failures here never undo billing.
  for (const id of toNotify) {
    await notifyInvoice(id).catch((err) => logger.warn({ err, invoiceId: id }, 'Invoice notification failed'));
  }

  return prisma.billingJobRun.findUniqueOrThrow({ where: { id: run.id } });
}

/** Preview of what a billing run would invoice on `asOf` (no side effects). */
export async function previewBilling(asOf: Date, page = 1, pageSize = 50) {
  const where = dueWhere(asOf);
  const [total, subs] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: [{ nextBillingDate: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        nextBillingDate: true,
        endDate: true,
        billingFrequency: true,
        billingInterval: true,
        billingAnchorDay: true,
        total: true,
        currency: true,
        customer: { select: { id: true, name: true, companyName: true } },
        plan: { select: { id: true, name: true } },
      },
    }),
  ]);
  const totals = await prisma.subscription.aggregate({ where, _sum: { total: true } });
  return {
    asOf: formatDateOnly(asOf),
    total,
    estimatedAmount: toMoneyString(totals._sum.total ?? 0),
    items: subs.map((s) => ({ ...s, periodsDue: countDuePeriods(s, asOf) })),
  };
}
