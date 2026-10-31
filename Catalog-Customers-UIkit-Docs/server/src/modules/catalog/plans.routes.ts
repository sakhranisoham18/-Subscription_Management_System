import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateString, idParam, money, optionalDateString, optionalText, optionalUuid, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { toDateOnly } from '../../domain/dates';

export const plansRouter = Router();

// Base fields carry no defaults so that PATCH (partial) never overwrites untouched columns.
const planFields = z.object({
  name: z.string().trim().min(2, 'Enter a plan name').max(120),
  description: optionalText(2000),
  billingFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  billingInterval: z.coerce.number().int().min(1).max(36),
  price: money,
  currency: z.string().trim().length(3).toUpperCase(),
  minQuantity: z.coerce.number().int().min(1).max(100000),
  availableFrom: dateString,
  availableUntil: optionalDateString,
  termLength: z.coerce.number().int().min(1).max(1000).nullable().optional(),
  autoClose: z.boolean(),
  autoRenew: z.boolean(),
  allowPause: z.boolean(),
  allowEarlyClose: z.boolean(),
  allowRenew: z.boolean(),
  taxRuleId: optionalUuid,
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
});

const planCreate = planFields.extend({
  billingInterval: planFields.shape.billingInterval.default(1),
  currency: planFields.shape.currency.default('INR'),
  minQuantity: planFields.shape.minQuantity.default(1),
  autoClose: z.boolean().default(true),
  autoRenew: z.boolean().default(false),
  allowPause: z.boolean().default(true),
  allowEarlyClose: z.boolean().default(true),
  allowRenew: z.boolean().default(true),
  status: planFields.shape.status.default('ACTIVE'),
});

function validateDates<T extends { availableFrom?: string; availableUntil?: string | null }>(body: T, ctx: z.RefinementCtx) {
  if (body.availableFrom && body.availableUntil && body.availableUntil < body.availableFrom) {
    ctx.addIssue({ code: 'custom', path: ['availableUntil'], message: 'End date must be on or after the start date' });
  }
}

const toData = (body: Partial<z.infer<typeof planFields>>) => ({
  ...body,
  availableFrom: body.availableFrom ? toDateOnly(body.availableFrom) : undefined,
  availableUntil: body.availableUntil === undefined ? undefined : body.availableUntil ? toDateOnly(body.availableUntil) : null,
});

plansRouter.get('/', requirePermission('plans:read'), async (req, res) => {
  const q = parse(
    paginationQuery.extend({
      status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
      billingFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
    }),
    req.query,
  );
  const where: Prisma.SubscriptionPlanWhereInput = {
    status: q.status,
    billingFrequency: q.billingFrequency,
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.subscriptionPlan.count({ where }),
    prisma.subscriptionPlan.findMany({
      where,
      orderBy: orderBy(q, ['name', 'price', 'billingFrequency', 'createdAt'] as const, 'createdAt'),
      ...pageArgs(q),
      include: { _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } }, },
    }),
  ]);
  res.json({ data: items.map(({ _count, ...p }) => ({ ...p, activeSubscriptions: _count.subscriptions })), meta: pageMeta(q, total) });
});

plansRouter.get('/:id', requirePermission('plans:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) throw notFound('Plan');
  const counts = await prisma.subscription.groupBy({ by: ['status'], where: { planId: id }, _count: true });
  res.json({ data: { ...plan, subscriptionCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])) } });
});

plansRouter.post('/', requirePermission('plans:write'), async (req, res) => {
  const body = parse(planCreate.superRefine(validateDates), req.body);
  const plan = await prisma.subscriptionPlan.create({ data: toData(body) as Prisma.SubscriptionPlanUncheckedCreateInput });
  await audit({ actorId: req.user!.id, action: 'PLAN_CREATED', entityType: 'SubscriptionPlan', entityId: plan.id, ip: req.ip });
  res.status(201).json({ data: plan });
});

/**
 * Plan changes affect FUTURE sales only: existing subscriptions keep the billing frequency, prices and
 * lines they were created with (snapshot). Lifecycle options (pause/close/renew) are read from the plan
 * at the time an action is performed.
 */
plansRouter.patch('/:id', requirePermission('plans:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!existing) throw notFound('Plan');
  const body = parse(
    planFields
      .partial()
      .superRefine((b, ctx) =>
        validateDates(
          { availableFrom: b.availableFrom ?? existing.availableFrom.toISOString().slice(0, 10), availableUntil: b.availableUntil },
          ctx,
        ),
      ),
    req.body,
  );
  const plan = await prisma.subscriptionPlan.update({ where: { id }, data: toData(body) as Prisma.SubscriptionPlanUncheckedUpdateInput });
  await audit({ actorId: req.user!.id, action: 'PLAN_UPDATED', entityType: 'SubscriptionPlan', entityId: id, details: Object.keys(body), ip: req.ip });
  res.json({ data: plan });
});
