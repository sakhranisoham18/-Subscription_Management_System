import { d, round2, sum, ZERO, assertNonNegative, type MoneyInput, type Dec } from './money';

export interface DocumentDiscount {
  type: 'FIXED' | 'PERCENTAGE';
  value: MoneyInput;
}

export interface PricingLineInput {
  quantity: number;
  unitPrice: MoneyInput;
  /** Negotiated line discount, 0–100 %. */
  discountPercent?: MoneyInput;
  /** Tax rate in percent, e.g. 18. */
  taxRate?: MoneyInput;
  /** Whether the document-level discount may be applied to this line. Defaults to true. */
  discountEligible?: boolean;
}

export interface PricedLine {
  quantity: number;
  unitPrice: Dec;
  discountPercent: Dec;
  taxRate: Dec;
  /** qty × unit price (gross) */
  lineSubtotal: Dec;
  /** line discount + allocated share of the document discount */
  discountAmount: Dec;
  taxableAmount: Dec;
  taxAmount: Dec;
  /** taxable + tax */
  lineTotal: Dec;
}

export interface PricedDocument {
  lines: PricedLine[];
  subtotal: Dec;
  lineDiscountTotal: Dec;
  documentDiscount: Dec;
  discountTotal: Dec;
  taxableTotal: Dec;
  taxTotal: Dec;
  total: Dec;
}

/** Final unit price of a product variant = product sales price + variant price adjustment. */
export function variantUnitPrice(basePrice: MoneyInput, priceAdjustment: MoneyInput = 0): Dec {
  const price = round2(d(basePrice).plus(d(priceAdjustment)));
  assertNonNegative(price, 'Variant price');
  return price;
}

/** Amount a document-level discount takes off an eligible base (never more than the base). */
export function discountAmountFor(discount: DocumentDiscount, eligibleBase: MoneyInput): Dec {
  const base = d(eligibleBase);
  if (base.lte(0)) return ZERO;
  const value = d(discount.value);
  assertNonNegative(value, 'Discount value');
  const raw = discount.type === 'PERCENTAGE' ? round2(base.mul(value.gt(100) ? 100 : value).div(100)) : round2(value);
  return raw.gt(base) ? round2(base) : raw;
}

/**
 * Prices a quotation / subscription / invoice.
 *
 * Order of operations (applied consistently everywhere):
 *   1. gross      = quantity × unit price
 *   2. line disc. = gross × line discount %
 *   3. document discount (fixed or %) is computed on the eligible lines' net amount and
 *      allocated across them proportionally (rounding remainder goes to the last eligible line)
 *   4. DISCOUNTS APPLY BEFORE TAX: tax = (gross − all discounts) × tax rate
 *   5. line total = taxable + tax; document totals are sums of the rounded line values
 */
export function priceDocument(lines: PricingLineInput[], discount?: DocumentDiscount | null): PricedDocument {
  const prepared = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError('Quantity must be a positive whole number');
    }
    const unitPrice = round2(line.unitPrice);
    assertNonNegative(unitPrice, 'Unit price');
    const discountPercent = d(line.discountPercent ?? 0);
    if (discountPercent.isNegative() || discountPercent.gt(100)) {
      throw new RangeError('Line discount must be between 0 and 100 percent');
    }
    const taxRate = d(line.taxRate ?? 0);
    assertNonNegative(taxRate, 'Tax rate');
    const gross = round2(unitPrice.mul(line.quantity));
    const lineDiscount = round2(gross.mul(discountPercent).div(100));
    return {
      quantity: line.quantity,
      unitPrice,
      discountPercent,
      taxRate,
      gross,
      lineDiscount,
      net: gross.minus(lineDiscount),
      eligible: line.discountEligible !== false,
    };
  });

  const eligibleBase = sum(prepared.filter((l) => l.eligible).map((l) => l.net));
  const documentDiscount = discount ? discountAmountFor(discount, eligibleBase) : ZERO;

  // allocate the document discount across eligible lines
  const shares = prepared.map(() => ZERO);
  if (documentDiscount.gt(0)) {
    const eligibleIdx = prepared.map((l, i) => (l.eligible && l.net.gt(0) ? i : -1)).filter((i) => i >= 0);
    let allocated = ZERO;
    eligibleIdx.forEach((idx, n) => {
      const isLast = n === eligibleIdx.length - 1;
      const share = isLast
        ? documentDiscount.minus(allocated)
        : round2(documentDiscount.mul(prepared[idx].net).div(eligibleBase));
      shares[idx] = share;
      allocated = allocated.plus(share);
    });
  }

  const priced: PricedLine[] = prepared.map((l, i) => {
    const discountAmount = l.lineDiscount.plus(shares[i]);
    const taxableAmount = l.gross.minus(discountAmount);
    const taxAmount = round2(taxableAmount.mul(l.taxRate).div(100));
    return {
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRate: l.taxRate,
      lineSubtotal: l.gross,
      discountAmount,
      taxableAmount,
      taxAmount,
      lineTotal: taxableAmount.plus(taxAmount),
    };
  });

  const subtotal = sum(priced.map((l) => l.lineSubtotal));
  const discountTotal = sum(priced.map((l) => l.discountAmount));
  const taxTotal = sum(priced.map((l) => l.taxAmount));
  const taxableTotal = subtotal.minus(discountTotal);
  return {
    lines: priced,
    subtotal,
    lineDiscountTotal: sum(prepared.map((l) => l.lineDiscount)),
    documentDiscount,
    discountTotal,
    taxableTotal,
    taxTotal,
    total: taxableTotal.plus(taxTotal),
  };
}
