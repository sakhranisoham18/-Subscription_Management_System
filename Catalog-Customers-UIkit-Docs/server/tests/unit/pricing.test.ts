import { describe, expect, it } from 'vitest';
import { discountAmountFor, priceDocument, variantUnitPrice } from '../../src/domain/pricing';

describe('variant pricing', () => {
  it('adds the variant price adjustment to the base price (Odoo brand +560)', () => {
    expect(variantUnitPrice('2000', '560').toFixed(2)).toBe('2560.00');
  });
  it('supports negative adjustments but never a negative final price', () => {
    expect(variantUnitPrice('2000', '-500').toFixed(2)).toBe('1500.00');
    expect(() => variantUnitPrice('100', '-200')).toThrow(/negative/);
  });
});

describe('document pricing', () => {
  it('reproduces the report example: 5 × 2,560, 10% discount, 18% tax = 13,593.60', () => {
    const doc = priceDocument([{ quantity: 5, unitPrice: '2560', taxRate: '18' }], { type: 'PERCENTAGE', value: '10' });
    expect(doc.subtotal.toFixed(2)).toBe('12800.00');
    expect(doc.discountTotal.toFixed(2)).toBe('1280.00');
    expect(doc.taxableTotal.toFixed(2)).toBe('11520.00');
    expect(doc.taxTotal.toFixed(2)).toBe('2073.60');
    expect(doc.total.toFixed(2)).toBe('13593.60');
  });

  it('applies a fixed discount before tax and allocates it proportionally across lines', () => {
    const doc = priceDocument(
      [
        { quantity: 1, unitPrice: '1000', taxRate: '18' },
        { quantity: 1, unitPrice: '3000', taxRate: '12' },
      ],
      { type: 'FIXED', value: '400' },
    );
    expect(doc.lines[0].discountAmount.toFixed(2)).toBe('100.00');
    expect(doc.lines[1].discountAmount.toFixed(2)).toBe('300.00');
    expect(doc.lines[0].taxAmount.toFixed(2)).toBe('162.00'); // 900 × 18%
    expect(doc.lines[1].taxAmount.toFixed(2)).toBe('324.00'); // 2700 × 12%
    expect(doc.total.toFixed(2)).toBe('4086.00');
  });

  it('never lets a fixed discount push the total below zero', () => {
    const doc = priceDocument([{ quantity: 1, unitPrice: '300', taxRate: '18' }], { type: 'FIXED', value: '500' });
    expect(doc.discountTotal.toFixed(2)).toBe('300.00');
    expect(doc.total.toFixed(2)).toBe('0.00');
  });

  it('combines line discounts with a document discount, only on eligible lines', () => {
    const doc = priceDocument(
      [
        { quantity: 2, unitPrice: '1000', discountPercent: '10', taxRate: '18' }, // net 1800
        { quantity: 1, unitPrice: '500', taxRate: '18', discountEligible: false },
      ],
      { type: 'PERCENTAGE', value: '50' },
    );
    expect(doc.lines[0].discountAmount.toFixed(2)).toBe('1100.00'); // 200 line + 900 doc
    expect(doc.lines[1].discountAmount.toFixed(2)).toBe('0.00');
    expect(doc.total.toFixed(2)).toBe(((900 + 500) * 1.18).toFixed(2));
  });

  it('rounds half-up per line and totals equal the sum of lines (no floating-point drift)', () => {
    const doc = priceDocument([
      { quantity: 3, unitPrice: '0.10', taxRate: '18' },
      { quantity: 7, unitPrice: '33.33', taxRate: '18' },
    ]);
    expect(doc.subtotal.toFixed(2)).toBe('233.61');
    const sumLines = doc.lines.reduce((a, l) => a + Number(l.lineTotal.toFixed(2)) * 100, 0) / 100;
    expect(doc.total.toFixed(2)).toBe(sumLines.toFixed(2));
    expect(doc.lines[0].taxAmount.toFixed(2)).toBe('0.05'); // 0.054 → 0.05
  });

  it('rejects invalid quantities, prices and discounts', () => {
    expect(() => priceDocument([{ quantity: 0, unitPrice: '10' }])).toThrow(/Quantity/);
    expect(() => priceDocument([{ quantity: 1.5, unitPrice: '10' }])).toThrow(/Quantity/);
    expect(() => priceDocument([{ quantity: 1, unitPrice: '-1' }])).toThrow(/negative/);
    expect(() => priceDocument([{ quantity: 1, unitPrice: '10', discountPercent: '120' }])).toThrow(/between 0 and 100/);
  });

  it('caps percentage discounts at 100%', () => {
    expect(discountAmountFor({ type: 'PERCENTAGE', value: '150' }, '200').toFixed(2)).toBe('200.00');
  });
});
