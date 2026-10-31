import { d, sum, round2, type MoneyInput, type Dec } from './money';
import { OPEN_INVOICE_STATUSES, type InvoiceStatus } from './lifecycle';

export interface AllocationInvoice {
  id: string;
  number: string;
  customerId: string;
  status: InvoiceStatus;
  balanceDue: MoneyInput;
}

export interface AllocationRequest {
  invoiceId: string;
  amount: MoneyInput;
}

/**
 * Validates how a payment is spread across invoices.
 *  - every allocation is positive and at most the invoice's outstanding balance (no over-allocation)
 *  - invoices must be open (Confirmed / Partially paid) and belong to the paying customer
 *  - the allocations must add up exactly to the payment amount (no unapplied credit in the MVP)
 * Returns a list of human-readable problems (empty = valid).
 */
export function validateAllocations(
  paymentAmount: MoneyInput,
  customerId: string,
  allocations: AllocationRequest[],
  invoices: AllocationInvoice[],
): string[] {
  const problems: string[] = [];
  const amount = round2(paymentAmount);
  if (amount.lte(0)) problems.push('Payment amount must be greater than zero');
  if (!allocations.length) problems.push('Allocate the payment to at least one invoice');

  const seen = new Set<string>();
  for (const a of allocations) {
    if (seen.has(a.invoiceId)) problems.push('Each invoice can appear only once per payment');
    seen.add(a.invoiceId);
    const inv = invoices.find((i) => i.id === a.invoiceId);
    const value = round2(a.amount);
    if (!inv) {
      problems.push('Invoice not found');
      continue;
    }
    if (inv.customerId !== customerId) problems.push(`Invoice ${inv.number} belongs to a different customer`);
    if (!OPEN_INVOICE_STATUSES.includes(inv.status)) {
      problems.push(`Invoice ${inv.number} is ${inv.status.toLowerCase().replace('_', ' ')} and cannot receive payments`);
    }
    if (value.lte(0)) problems.push(`Allocation to ${inv.number} must be greater than zero`);
    if (value.gt(d(inv.balanceDue))) {
      problems.push(`Allocation to ${inv.number} exceeds its outstanding balance of ${d(inv.balanceDue).toFixed(2)}`);
    }
  }
  const allocated = sum(allocations.map((a) => round2(a.amount)));
  if (allocations.length && !allocated.eq(amount)) {
    problems.push(`Allocations (${allocated.toFixed(2)}) must equal the payment amount (${amount.toFixed(2)})`);
  }
  return problems;
}

/** New paid/outstanding figures for an invoice after applying (or reversing) an amount. */
export function applyToInvoice(total: MoneyInput, amountPaid: MoneyInput, delta: MoneyInput): { amountPaid: Dec; balanceDue: Dec } {
  const paid = round2(d(amountPaid).plus(d(delta)));
  if (paid.isNegative()) throw new RangeError('Amount paid cannot become negative');
  if (paid.gt(d(total))) throw new RangeError('Payment would exceed the invoice total');
  return { amountPaid: paid, balanceDue: round2(d(total).minus(paid)) };
}
