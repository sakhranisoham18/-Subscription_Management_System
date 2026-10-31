import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { dateString, idParam, money, optionalDateString, optionalText, optionalUuid, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { toDateOnly } from '../../domain/dates';
import { businessToday } from '../../lib/settings';
import { eligibleDiscountsFor, lineInput } from '../../services/documentPricing';

/** Discount rules — only the admin can create or change them (brief). Staff can view and apply them. */
export const discountsRouter = Router();

const fields = z.object({
  code: z.string().trim().min(3).max(30).regex(/^[A-Z0-9_-]+$/i, 'Use letters, numbers, - and _ only').transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  description: optionalText(500),
  type: z.enum(['FIXED', 'PERCENTAGE']),
  value: money,
  minPurchase: z.union([money, z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null)),
  minQuantity: z.coerce.number().int().min(1).nullable().optional(),
  startsAt: dateString,
  endsAt: optionalDateString,
  usageLimit: z.coerce.number().int().min(1).nullable().optional(),
  scope: z.enum(['ALL', 'PRODUCT', 'PLAN', 'SUBSCRIPTION']),
  productId: optionalUuid,
  planId: optionalUuid,
  subscriptionId: optionalUuid,
  autoApply: z.boolean(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
});

type Fields = Partial<z.infer<typeof fields>>;

function check(b: Fields) {
  if (b.type === 'PERCENTAGE' && b.value && Number(b.value) > 100) throw unprocessable('A percentage discount cannot exceed 100%');
  if (b.value !== undefined && Number(b.value) <= 0) throw unprocessable('Discount value must be greater than zero');
  if (b.startsAt && b.endsAt && b.endsAt < b.startsAt) throw unprocessable('End date must be on or after the start date');
  if (b.scope === 'PRODUCT' && !b.productId) throw unprocessable('Select the product this discount applies to');
  if (b.scope === 'PLAN' && !b.planId) throw unprocessable('Select the plan this discount applies to');
  if (b.scope === 'SUBSCRIPTION' && !b.subscriptionId) throw unprocessable('Select the subscription this discount applies to');
}

const toData = (b: Fields) => ({
  ...b,
  startsAt: b.startsAt ? toDateOnly(b.startsAt) : undefined,
  endsAt: b.endsAt === undefined ? undefined : b.endsAt ? toDateOnly(b.endsAt) : null,
  // only keep the target that matches the scope
  ...(b.scope
    ? {
        productId: b.scope === 'PRODUCT' ? b.productId : null,
        planId: b.scope === 'PLAN' ? b.planId : null,
        subscriptionId: b.scope === 'SUBSCRIPTION' ? b.subscriptionId : null,
      }
    : {}),
});

discountsRouter.get('/', requirePermission('discounts:read'), async (req, res) => {
  const q = parse(
    paginationQuery.extend({
      status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
      state: z.enum(['current', 'expired', 'exhausted', 'scheduled']).optional(),
    }),
    req.query,
  );
  const today = await businessToday();
  const stateWhere: Record<string, Prisma.DiscountWhereInput> = {
    current: { status: 'ACTIVE', startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gte: today } }] },
    expired: { endsAt: { lt: today } },
    scheduled: { startsAt: { gt: today } },
    exhausted: { usageLimit: { not: null }, usedCount: { gte: prisma.discount.fields.usageLimit } },
  };
  const where: Prisma.DiscountWhereInput = {
    status: q.status,
    ...(q.state ? stateWhere[q.state] : {}),
    ...(q.search ? { AND: [{ OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.discount.count({ where }),
    prisma.discount.findMany({
      where,
      orderBy: orderBy(q, ['code', 'name', 'startsAt', 'endsAt', 'createdAt'] as const, 'createdAt'),
      ...pageArgs(q),
      include: {
        product: { select: { id: true, name: true } },
        plan: { select: { id: true, name: true } },
        subscription: { select: { id: true, number: true } },
      },
    }),
  ]);
  res.json({ data: items, meta: pageMeta(q, total) });
});

/** Which discounts would apply to a draft quotation/subscription right now (server-evaluated). */
discountsRouter.post('/eligible', requirePermission('quotations:read'), async (req, res) => {
  const body = parse(
    z.object({ planId: optionalUuid, lines: z.array(lineInput).min(1), date: dateString.optional(), subscriptionId: optionalUuid }),
    req.body,
  );
  const date = body.date ? toDateOnly(body.date) : await businessToday();
  res.json({ data: await eligibleDiscountsFor({ planId: body.planId ?? null, lines: body.lines, date, subscriptionId: body.subscriptionId }) });
});

discountsRouter.get('/:id', requirePermission('discounts:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const discount = await prisma.discount.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, name: true } },
      plan: { select: { id: true, name: true } },
      subscription: { select: { id: true, number: true } },
      usages: {
        orderBy: { usedAt: 'desc' },
        take: 50,
        include: { invoice: { select: { id: true, number: true } }, customer: { select: { id: true, name: true, companyName: true } } },
      },
    },
  });
  if (!discount) throw notFound('Discount');
  const history = await prisma.auditLog.findMany({
    where: { entityType: 'Discount', entityId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { actor: { select: { name: true } } },
  });
  res.json({ data: { ...discount, history } });
});

discountsRouter.post('/', requirePermission('discounts:write'), async (req, res) => {
  const body = parse(
    fields.extend({ scope: fields.shape.scope.default('ALL'), autoApply: z.boolean().default(true), status: fields.shape.status.default('ACTIVE') }),
    req.body,
  );
  check(body);
  const discount = await prisma.discount.create({ data: toData(body) as Prisma.DiscountUncheckedCreateInput });
  await audit({ actorId: req.user!.id, action: 'DISCOUNT_CREATED', entityType: 'Discount', entityId: discount.id, details: body as Prisma.InputJsonValue, ip: req.ip });
  res.status(201).json({ data: discount });
});

discountsRouter.patch('/:id', requirePermission('discounts:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const existing = await prisma.discount.findUnique({ where: { id } });
  if (!existing) throw notFound('Discount');
  const body = parse(fields.partial(), req.body);
  check({
    type: body.type ?? existing.type,
    value: body.value ?? existing.value.toString(),
    startsAt: body.startsAt ?? existing.startsAt.toISOString().slice(0, 10),
    endsAt: body.endsAt === undefined ? existing.endsAt?.toISOString().slice(0, 10) ?? null : body.endsAt,
    scope: body.scope ?? existing.scope,
    productId: body.productId === undefined ? existing.productId : body.productId,
    planId: body.planId === undefined ? existing.planId : body.planId,
    subscriptionId: body.subscriptionId === undefined ? existing.subscriptionId : body.subscriptionId,
  });
  if (body.usageLimit !== undefined && body.usageLimit !== null && body.usageLimit < existing.usedCount) {
    throw unprocessable(`Usage limit cannot be lower than the ${existing.usedCount} times already used`);
  }
  const discount = await prisma.discount.update({ where: { id }, data: toData(body) as Prisma.DiscountUncheckedUpdateInput });
  await audit({ actorId: req.user!.id, action: 'DISCOUNT_UPDATED', entityType: 'Discount', entityId: id, details: body as Prisma.InputJsonValue, ip: req.ip });
  res.json({ data: discount });
});
