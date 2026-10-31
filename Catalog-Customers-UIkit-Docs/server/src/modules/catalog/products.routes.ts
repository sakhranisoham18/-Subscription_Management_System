import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { idParam, money, optionalText, optionalUuid, orderBy, pageArgs, pageMeta, paginationQuery, parse } from '../../lib/http';
import { notFound, unprocessable } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { variantUnitPrice } from '../../domain/pricing';
import { toMoneyString } from '../../domain/money';

export const productsRouter = Router();

const productFields = z.object({
  name: z.string().trim().min(2, 'Enter a product name').max(120),
  productType: z.string().trim().min(2, 'Enter a product type').max(60),
  salesPrice: money,
  costPrice: money,
  description: optionalText(2000),
  taxRuleId: optionalUuid,
});

/** Signed price adjustment: a variant may add to or subtract from the base price. */
const adjustment = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), 'Enter an amount with up to 2 decimals');

const variantFields = z.object({
  name: z.string().trim().min(1, 'Enter a variant name').max(80),
  attribute: z.string().trim().min(1, 'Enter the attribute (e.g. Brand)').max(60),
  priceAdjustment: adjustment,
});
const variantCreate = variantFields.extend({ priceAdjustment: adjustment.default('0') });

function withFinalPrices<T extends { salesPrice: Prisma.Decimal; variants?: { priceAdjustment: Prisma.Decimal }[] }>(p: T) {
  return {
    ...p,
    variants: p.variants?.map((v) => ({ ...v, finalPrice: toMoneyString(variantUnitPrice(p.salesPrice, v.priceAdjustment)) })),
  };
}

productsRouter.get('/', requirePermission('products:read'), async (req, res) => {
  const q = parse(
    paginationQuery.extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional(), productType: z.string().max(60).optional() }),
    req.query,
  );
  const where: Prisma.ProductWhereInput = {
    status: q.status,
    productType: q.productType || undefined,
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { productType: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const [total, items, types] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: orderBy(q, ['name', 'productType', 'salesPrice', 'createdAt'] as const, 'createdAt'),
      ...pageArgs(q),
      include: { variants: { orderBy: { createdAt: 'asc' } }, taxRule: { select: { id: true, name: true, rate: true } } },
    }),
    prisma.product.findMany({ distinct: ['productType'], select: { productType: true } }),
  ]);
  res.json({ data: items.map(withFinalPrices), meta: { ...pageMeta(q, total), productTypes: types.map((t) => t.productType) } });
});

productsRouter.get('/:id', requirePermission('products:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const product = await prisma.product.findUnique({
    where: { id },
    include: { variants: { orderBy: { createdAt: 'asc' } }, taxRule: { select: { id: true, name: true, rate: true } } },
  });
  if (!product) throw notFound('Product');
  const usage = await prisma.subscriptionLine.count({ where: { productId: id, subscription: { status: { in: ['ACTIVE', 'PAUSED', 'CONFIRMED'] } } } });
  res.json({ data: { ...withFinalPrices(product), activeSubscriptionLines: usage } });
});

productsRouter.post('/', requirePermission('products:write'), async (req, res) => {
  const body = parse(productFields.extend({ variants: z.array(variantCreate).max(50).optional().default([]) }), req.body);
  for (const v of body.variants) {
    if (Number(body.salesPrice) + Number(v.priceAdjustment) < 0) throw unprocessable(`Variant "${v.name}" would have a negative price`);
  }
  const product = await prisma.product.create({
    data: { ...body, variants: { create: body.variants } },
    include: { variants: true },
  });
  await audit({ actorId: req.user!.id, action: 'PRODUCT_CREATED', entityType: 'Product', entityId: product.id, ip: req.ip });
  res.status(201).json({ data: withFinalPrices(product) });
});

productsRouter.patch('/:id', requirePermission('products:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(productFields.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }), req.body);
  const existing = await prisma.product.findUnique({ where: { id }, include: { variants: true } });
  if (!existing) throw notFound('Product');
  if (body.salesPrice) {
    for (const v of existing.variants) {
      if (Number(body.salesPrice) + Number(v.priceAdjustment) < 0) throw unprocessable(`Variant "${v.name}" would have a negative price`);
    }
  }
  // Historical quotation/subscription/invoice lines keep their own description and price snapshot.
  const product = await prisma.product.update({ where: { id }, data: body, include: { variants: true } });
  await audit({ actorId: req.user!.id, action: body.status === 'ARCHIVED' ? 'PRODUCT_ARCHIVED' : 'PRODUCT_UPDATED', entityType: 'Product', entityId: id, details: body, ip: req.ip });
  res.json({ data: withFinalPrices(product) });
});

// ── Variants ──
productsRouter.post('/:id/variants', requirePermission('products:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(variantCreate, req.body);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw notFound('Product');
  variantUnitPrice(product.salesPrice, body.priceAdjustment); // throws on negative
  const variant = await prisma.productVariant.create({ data: { ...body, productId: id } });
  await audit({ actorId: req.user!.id, action: 'VARIANT_CREATED', entityType: 'Product', entityId: id, details: { variant: variant.name, priceAdjustment: body.priceAdjustment } });
  res.status(201).json({ data: { ...variant, finalPrice: toMoneyString(variantUnitPrice(product.salesPrice, variant.priceAdjustment)) } });
});

productsRouter.patch('/:id/variants/:variantId', requirePermission('products:write'), async (req, res) => {
  const { id, variantId } = parse(z.object({ id: z.string().uuid(), variantId: z.string().uuid() }), req.params);
  const body = parse(variantFields.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }), req.body);
  const variant = await prisma.productVariant.findFirst({ where: { id: variantId, productId: id }, include: { product: true } });
  if (!variant) throw notFound('Variant');
  if (body.priceAdjustment !== undefined) variantUnitPrice(variant.product.salesPrice, body.priceAdjustment);
  const updated = await prisma.productVariant.update({ where: { id: variantId }, data: body });
  await audit({ actorId: req.user!.id, action: 'VARIANT_UPDATED', entityType: 'Product', entityId: id, details: { variantId, ...body } });
  res.json({ data: { ...updated, finalPrice: toMoneyString(variantUnitPrice(variant.product.salesPrice, updated.priceAdjustment)) } });
});
