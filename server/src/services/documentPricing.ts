import { z } from 'zod';
import type { Discount, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { percent } from '../lib/http';
import { unprocessable } from '../lib/errors';
import { priceDocument, variantUnitPrice, type PricedDocument } from '../domain/pricing';
import { evaluateDiscount, type DiscountRule } from '../domain/discounts';
import { d, toMoneyString } from '../domain/money';

/**
 * Line input accepted from the browser. Prices are NEVER accepted from the client: unit prices
 * come from the plan / product / variant, tax rates from tax rules, and totals are recomputed.
 * Negotiated pricing is expressed through the line discount percentage.
 */
export const lineInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PLAN'),
    quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(100000),
    discountPercent: percent.optional().default('0'),
    taxRuleId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    type: z.literal('PRODUCT'),
    productId: z.string().uuid('Select a product'),
    variantId: z.string().uuid().nullable().optional(),
    quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(100000),
    discountPercent: percent.optional().default('0'),
    taxRuleId: z.string().uuid().nullable().optional(),
  }),
]);
export type LineInput = z.infer<typeof lineInput>;

export interface ResolvedLine {
  type: 'PLAN' | 'PRODUCT';
  planId: string | null;
  productId: string | null;
  variantId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  discountPercent: string;
  taxRuleId: string | null;
  taxRate: string;
}

export interface PricedLineRow extends ResolvedLine {
  lineSubtotal: string;
  discountAmount: string;
  taxAmount: string;
  lineTotal: string;
  sortOrder: number;
}

export interface PricingResult {
  lines: PricedLineRow[];
  subtotal: string;
  discountTotal: string;
  documentDiscount: string;
  taxTotal: string;
  total: string;
  discount: Pick<Discount, 'id' | 'code' | 'name' | 'type' | 'value'> | null;
}

export function toDiscountRule(x: Discount): DiscountRule {
  return {
    id: x.id,
    type: x.type,
    value: x.value,
    status: x.status,
    startsAt: x.startsAt,
    endsAt: x.endsAt,
    usageLimit: x.usageLimit,
    usedCount: x.usedCount,
    minPurchase: x.minPurchase,
    minQuantity: x.minQuantity,
    scope: x.scope,
    productId: x.productId,
    planId: x.planId,
    subscriptionId: x.subscriptionId,
  };
}

/** Resolves catalogue data for each requested line and validates it for a NEW sale on `date`. */
export async function resolveLines(
  db: Tx,
  planId: string | null,
  inputs: LineInput[],
  date: Date,
  opts: { allowArchived?: boolean; skipPlanChecks?: boolean } = {},
): Promise<ResolvedLine[]> {
  if (!inputs.length) throw unprocessable('Add at least one line');
  const plan = planId ? await db.subscriptionPlan.findUnique({ where: { id: planId } }) : null;
  if (planId && !plan) throw unprocessable('Selected plan does not exist');
  if (!plan && inputs.some((l) => l.type === 'PLAN')) throw unprocessable('Plan lines need a plan');
  if (plan && !opts.allowArchived && !opts.skipPlanChecks) {
    if (plan.status !== 'ACTIVE') throw unprocessable(`Plan "${plan.name}" is not active`);
    if (date < plan.availableFrom || (plan.availableUntil && date > plan.availableUntil)) {
      throw unprocessable(`Plan "${plan.name}" is not available on this date`);
    }
  }

  const productIds = [...new Set(inputs.flatMap((l) => (l.type === 'PRODUCT' ? [l.productId] : [])))];
  const products = await db.product.findMany({ where: { id: { in: productIds } }, include: { variants: true } });
  const taxIds = [...new Set(inputs.map((l) => l.taxRuleId).filter((x): x is string => Boolean(x)))];
  const [taxes, defaultTax] = await Promise.all([
    db.taxRule.findMany({ where: { id: { in: taxIds } } }),
    db.taxRule.findFirst({ where: { isDefault: true, status: 'ACTIVE' } }),
  ]);
  const allTaxIds = [plan?.taxRuleId ?? null, ...products.map((p) => p.taxRuleId)].filter((x): x is string => Boolean(x));
  const fallbackTaxes = await db.taxRule.findMany({ where: { id: { in: allTaxIds } } });
  const taxById = new Map([...taxes, ...fallbackTaxes].map((t) => [t.id, t]));

  const pickTax = (explicit: string | null | undefined, ...fallbacks: (string | null)[]) => {
    if (explicit) {
      const t = taxById.get(explicit);
      if (!t || t.status !== 'ACTIVE') throw unprocessable('Selected tax rule is not active');
      return t;
    }
    for (const id of fallbacks) {
      const t = id ? taxById.get(id) : undefined;
      if (t && t.status === 'ACTIVE') return t;
    }
    return defaultTax;
  };

  return inputs.map((l) => {
    if (l.type === 'PLAN') {
      if (!plan) throw unprocessable('Plan lines need a plan');
      if (l.quantity < plan.minQuantity) {
        throw unprocessable(`Plan "${plan.name}" requires a minimum quantity of ${plan.minQuantity}`);
      }
      const tax = pickTax(l.taxRuleId, plan.taxRuleId);
      return {
        type: 'PLAN' as const,
        planId: plan.id,
        productId: null,
        variantId: null,
        description: `${plan.name} — ${plan.billingFrequency.toLowerCase()} plan`,
        quantity: l.quantity,
        unitPrice: toMoneyString(plan.price),
        discountPercent: d(l.discountPercent).toFixed(4),
        taxRuleId: tax?.id ?? null,
        taxRate: tax ? d(tax.rate).toFixed(4) : '0.0000',
      };
    }
    const product = products.find((p) => p.id === l.productId);
    if (!product) throw unprocessable('Selected product does not exist');
    if (!opts.allowArchived && product.status !== 'ACTIVE') {
      throw unprocessable(`Product "${product.name}" is archived and cannot be sold`);
    }
    let description = product.name;
    let unit = d(product.salesPrice);
    if (l.variantId) {
      const variant = product.variants.find((v) => v.id === l.variantId);
      if (!variant) throw unprocessable(`Variant does not belong to "${product.name}"`);
      if (!opts.allowArchived && variant.status !== 'ACTIVE') throw unprocessable(`Variant "${variant.name}" is archived`);
      unit = variantUnitPrice(product.salesPrice, variant.priceAdjustment);
      description = `${product.name} (${variant.attribute}: ${variant.name})`;
    }
    const tax = pickTax(l.taxRuleId, product.taxRuleId);
    return {
      type: 'PRODUCT' as const,
      planId: null,
      productId: product.id,
      variantId: l.variantId ?? null,
      description,
      quantity: l.quantity,
      unitPrice: toMoneyString(unit),
      discountPercent: d(l.discountPercent).toFixed(4),
      taxRuleId: tax?.id ?? null,
      taxRate: tax ? d(tax.rate).toFixed(4) : '0.0000',
    };
  });
}

/** Applies pricing + an optional document discount to resolved lines. */
export function priceResolvedLines(
  resolved: ResolvedLine[],
  discount: { rule: Discount; eligibleIdx: number[] } | null,
): { priced: PricedDocument; rows: PricedLineRow[] } {
  const priced = priceDocument(
    resolved.map((l, i) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRate: l.taxRate,
      discountEligible: discount ? discount.eligibleIdx.includes(i) : false,
    })),
    discount ? { type: discount.rule.type, value: discount.rule.value } : null,
  );
  const rows = resolved.map((l, i) => ({
    ...l,
    lineSubtotal: toMoneyString(priced.lines[i].lineSubtotal),
    discountAmount: toMoneyString(priced.lines[i].discountAmount),
    taxAmount: toMoneyString(priced.lines[i].taxAmount),
    lineTotal: toMoneyString(priced.lines[i].lineTotal),
    sortOrder: i,
  }));
  return { priced, rows };
}

/** Net line amounts (after line discounts) used for discount eligibility. */
export function discountContextLines(resolved: ResolvedLine[]) {
  return resolved.map((l) => {
    const gross = d(l.unitPrice).mul(l.quantity);
    return {
      productId: l.productId,
      quantity: l.quantity,
      netAmount: gross.minus(gross.mul(d(l.discountPercent)).div(100)).toDecimalPlaces(2),
    };
  });
}

/**
 * Prices a quotation/subscription draft. When `discountId` is given it must be eligible,
 * otherwise a 422 explains why.
 */
export async function priceDraft(
  db: Tx,
  args: {
    planId: string | null;
    lines: LineInput[];
    date: Date;
    discountId?: string | null;
    subscriptionId?: string | null;
    allowArchived?: boolean;
    skipPlanChecks?: boolean;
  },
): Promise<PricingResult> {
  const resolved = await resolveLines(db, args.planId, args.lines, args.date, {
    allowArchived: args.allowArchived,
    skipPlanChecks: args.skipPlanChecks,
  });
  let discount: { rule: Discount; eligibleIdx: number[] } | null = null;
  if (args.discountId) {
    const rule = await db.discount.findUnique({ where: { id: args.discountId } });
    if (!rule) throw unprocessable('Selected discount does not exist');
    const result = evaluateDiscount(toDiscountRule(rule), {
      date: args.date,
      planId: args.planId,
      subscriptionId: args.subscriptionId ?? null,
      lines: discountContextLines(resolved),
    });
    if (!result.eligible) throw unprocessable(`Discount ${rule.code} cannot be applied: ${result.reason}`);
    discount = { rule, eligibleIdx: result.eligibleLineIndexes };
  }
  const { priced, rows } = priceResolvedLines(resolved, discount);
  return {
    lines: rows,
    subtotal: toMoneyString(priced.subtotal),
    discountTotal: toMoneyString(priced.discountTotal),
    documentDiscount: toMoneyString(priced.documentDiscount),
    taxTotal: toMoneyString(priced.taxTotal),
    total: toMoneyString(priced.total),
    discount: discount
      ? { id: discount.rule.id, code: discount.rule.code, name: discount.rule.name, type: discount.rule.type, value: discount.rule.value }
      : null,
  };
}

/** Lists discounts that could currently apply to a draft (for the "apply discount" picker). */
export async function eligibleDiscountsFor(
  args: { planId: string | null; lines: LineInput[]; date: Date; subscriptionId?: string | null },
) {
  const resolved = await resolveLines(prisma, args.planId, args.lines, args.date, { skipPlanChecks: true });
  const rules = await prisma.discount.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } });
  const ctx = { date: args.date, planId: args.planId, subscriptionId: args.subscriptionId ?? null, lines: discountContextLines(resolved) };
  return rules.map((r) => {
    const result = evaluateDiscount(toDiscountRule(r), ctx);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      value: r.value,
      eligible: result.eligible,
      reason: result.eligible ? null : result.reason,
      amount: result.eligible ? toMoneyString(result.amount) : null,
    };
  });
}

export type LineCreate = Omit<Prisma.QuotationLineCreateManyInput, 'quotationId'>;
