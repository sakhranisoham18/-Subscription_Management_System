import { d, type MoneyInput } from './money';

// ───────── Subscription lifecycle: Draft → Quotation → Confirmed → Active → Closed (+ Paused) ─────────
export type SubscriptionStatus = 'DRAFT' | 'QUOTATION' | 'CONFIRMED' | 'ACTIVE' | 'PAUSED' | 'CLOSED';

export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  DRAFT: ['QUOTATION', 'CONFIRMED', 'CLOSED'],
  QUOTATION: ['DRAFT', 'CONFIRMED', 'CLOSED'],
  CONFIRMED: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

/** Only these statuses may be billed by the recurring billing engine. */
export const BILLABLE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['ACTIVE'];

/** Subscription lines and plan can only be edited before confirmation. */
export const EDITABLE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['DRAFT', 'QUOTATION'];

// ───────── Quotation lifecycle ─────────
export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'DRAFT'],
  ACCEPTED: ['CONVERTED'],
  REJECTED: ['DRAFT'],
  EXPIRED: ['DRAFT'],
  CONVERTED: [],
};

export function canTransitionQuotation(from: QuotationStatus, to: QuotationStatus): boolean {
  return QUOTATION_TRANSITIONS[from].includes(to);
}

// ───────── Invoice lifecycle: Draft → Confirmed → (Partially paid) → Paid; Cancelled ─────────
export type InvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

/** Invoice status is derived from payments: it becomes PAID only when payments cover the total. */
export function invoiceStatusFromPayments(total: MoneyInput, amountPaid: MoneyInput): InvoiceStatus {
  const paid = d(amountPaid);
  if (paid.gte(d(total)) && d(total).gt(0)) return 'PAID';
  if (paid.gt(0)) return 'PARTIALLY_PAID';
  if (d(total).eq(0)) return 'PAID';
  return 'CONFIRMED';
}

export const OPEN_INVOICE_STATUSES: InvoiceStatus[] = ['CONFIRMED', 'PARTIALLY_PAID'];

/** Overdue = open invoice with an unpaid balance after its due date (derived, not stored). */
export function isOverdue(
  invoice: { status: InvoiceStatus; dueDate: Date; balanceDue: MoneyInput },
  today: Date,
): boolean {
  return OPEN_INVOICE_STATUSES.includes(invoice.status) && d(invoice.balanceDue).gt(0) && invoice.dueDate < today;
}

export function displayInvoiceStatus(
  invoice: { status: InvoiceStatus; dueDate: Date; balanceDue: MoneyInput },
  today: Date,
): InvoiceStatus | 'OVERDUE' {
  return isOverdue(invoice, today) ? 'OVERDUE' : invoice.status;
}
