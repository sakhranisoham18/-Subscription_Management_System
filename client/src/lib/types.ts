export type Role = 'ADMIN' | 'STAFF' | 'CUSTOMER';
export type Money = string;

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  permissions: string[];
  customer: { id: string; companyName: string | null; name: string } | null;
}

export interface TaxRule {
  id: string;
  name: string;
  rate: Money;
  description: string | null;
  isDefault: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Variant {
  id: string;
  name: string;
  attribute: string;
  priceAdjustment: Money;
  finalPrice: Money;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Product {
  id: string;
  name: string;
  productType: string;
  salesPrice: Money;
  costPrice: Money;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  taxRuleId: string | null;
  taxRule: { id: string; name: string; rate: Money } | null;
  variants: Variant[];
  createdAt: string;
}

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  billingFrequency: Frequency;
  billingInterval: number;
  price: Money;
  currency: string;
  minQuantity: number;
  availableFrom: string;
  availableUntil: string | null;
  termLength: number | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  autoClose: boolean;
  autoRenew: boolean;
  allowPause: boolean;
  allowEarlyClose: boolean;
  allowRenew: boolean;
  taxRuleId: string | null;
  activeSubscriptions?: number;
}

export interface Discount {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: 'FIXED' | 'PERCENTAGE';
  value: Money;
  minPurchase: Money | null;
  minQuantity: number | null;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  scope: 'ALL' | 'PRODUCT' | 'PLAN' | 'SUBSCRIPTION';
  productId: string | null;
  planId: string | null;
  subscriptionId: string | null;
  autoApply: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  product?: { id: string; name: string } | null;
  plan?: { id: string; name: string } | null;
  subscription?: { id: string; number: string } | null;
}

export interface CustomerRow {
  id: string;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  hasPortalAccess: boolean;
  activeSubscriptions: number;
  outstanding: Money;
}

export interface DocLine {
  id?: string;
  planId?: string | null;
  productId: string | null;
  variantId: string | null;
  isPlanFee?: boolean;
  description: string;
  quantity: number;
  unitPrice: Money;
  discountPercent: Money;
  taxRuleId: string | null;
  taxRate: Money;
  lineSubtotal: Money;
  discountAmount: Money;
  taxAmount: Money;
  lineTotal: Money;
}

export interface LineInput {
  type: 'PLAN' | 'PRODUCT';
  productId?: string;
  variantId?: string | null;
  quantity: number;
  discountPercent?: string;
  taxRuleId?: string | null;
}

export interface Pricing {
  lines: (DocLine & { type: 'PLAN' | 'PRODUCT' })[];
  subtotal: Money;
  discountTotal: Money;
  documentDiscount: Money;
  taxTotal: Money;
  total: Money;
  discount: { id: string; code: string; name: string } | null;
}

export type SubscriptionStatus = 'DRAFT' | 'QUOTATION' | 'CONFIRMED' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type InvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export interface HistoryEntry {
  id: string;
  action: string;
  createdAt: string;
  details: unknown;
  actor: { name: string } | null;
}
