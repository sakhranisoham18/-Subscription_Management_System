import { d, sum, type MoneyInput, type Dec } from './money';
import { discountAmountFor } from './pricing';

export interface DiscountRule {
  id: string;
  type: 'FIXED' | 'PERCENTAGE';
  value: MoneyInput;
  status: 'ACTIVE' | 'ARCHIVED';
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  minPurchase: MoneyInput | null;
  minQuantity: number | null;
  scope: 'ALL' | 'PRODUCT' | 'PLAN' | 'SUBSCRIPTION';
  productId: string | null;
  planId: string | null;
  subscriptionId: string | null;
}

export interface DiscountContextLine {
  productId?: string | null;
  quantity: number;
  /** net amount of the line after its own line discount */
  netAmount: MoneyInput;
}

export interface DiscountContext {
  date: Date;
  planId?: string | null;
  subscriptionId?: string | null;
  lines: DiscountContextLine[];
}

export type EligibilityResult =
  | { eligible: true; eligibleLineIndexes: number[]; eligibleBase: Dec; amount: Dec }
  | { eligible: false; reason: string };

/**
 * A discount applies when ALL of these hold:
 *   - it is active, today is within [startsAt, endsAt] and the usage cap has not been reached
 *   - its scope matches (ALL; PRODUCT → lines with that product; PLAN → that plan; SUBSCRIPTION → that subscription)
 *   - the eligible lines reach the minimum purchase amount and minimum quantity
 */
export function evaluateDiscount(rule: DiscountRule, ctx: DiscountContext): EligibilityResult {
  if (rule.status !== 'ACTIVE') return { eligible: false, reason: 'Discount is inactive' };
  if (ctx.date < rule.startsAt) return { eligible: false, reason: 'Discount has not started yet' };
  if (rule.endsAt && ctx.date > rule.endsAt) return { eligible: false, reason: 'Discount has expired' };
  if (rule.usageLimit !== null && rule.usedCount >= rule.usageLimit) {
    return { eligible: false, reason: 'Discount usage limit reached' };
  }

  let idx: number[] = ctx.lines.map((_, i) => i);
  switch (rule.scope) {
    case 'PRODUCT':
      idx = idx.filter((i) => ctx.lines[i].productId && ctx.lines[i].productId === rule.productId);
      if (!idx.length) return { eligible: false, reason: 'No lines for the discounted product' };
      break;
    case 'PLAN':
      if (!ctx.planId || ctx.planId !== rule.planId) return { eligible: false, reason: 'Discount is for a different plan' };
      break;
    case 'SUBSCRIPTION':
      if (!ctx.subscriptionId || ctx.subscriptionId !== rule.subscriptionId) {
        return { eligible: false, reason: 'Discount is for a different subscription' };
      }
      break;
    case 'ALL':
      break;
  }

  const eligibleBase = sum(idx.map((i) => ctx.lines[i].netAmount));
  const quantity = idx.reduce((q, i) => q + ctx.lines[i].quantity, 0);
  if (rule.minPurchase !== null && eligibleBase.lt(d(rule.minPurchase))) {
    return { eligible: false, reason: `Minimum purchase of ${d(rule.minPurchase).toFixed(2)} not met` };
  }
  if (rule.minQuantity !== null && quantity < rule.minQuantity) {
    return { eligible: false, reason: `Minimum quantity of ${rule.minQuantity} not met` };
  }
  const amount = discountAmountFor({ type: rule.type, value: rule.value }, eligibleBase);
  if (amount.lte(0)) return { eligible: false, reason: 'Discount would not reduce the total' };
  return { eligible: true, eligibleLineIndexes: idx, eligibleBase, amount };
}

/** Picks the single eligible discount with the largest saving (one document-level discount per invoice). */
export function pickBestDiscount<T extends DiscountRule>(rules: T[], ctx: DiscountContext) {
  let best: { rule: T; result: Extract<EligibilityResult, { eligible: true }> } | null = null;
  for (const rule of rules) {
    const result = evaluateDiscount(rule, ctx);
    if (result.eligible && (!best || result.amount.gt(best.result.amount))) best = { rule, result };
  }
  return best;
}
