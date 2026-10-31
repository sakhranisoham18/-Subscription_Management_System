/**
 * Brightloop Software — Subscription Management System
 * DEMO SEED DATA. Wipes the database and loads a realistic, fictional demo dataset.
 * All people, companies and credentials below are fictional and for local/demo use only.
 */
import { PrismaClient, type Prisma, type BillingFrequency, type PaymentMethod } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { priceDocument } from '../src/domain/pricing';
import { evaluateDiscount, type DiscountRule } from '../src/domain/discounts';
import { addBillingPeriods, addDays, billingPeriod, dateOnly, formatDateOnly, todayIn, type Frequency } from '../src/domain/dates';
import { d, toMoneyString } from '../src/domain/money';
import { invoiceStatusFromPayments } from '../src/domain/lifecycle';

const prisma = new PrismaClient();
const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const TODAY = todayIn(TZ);

// deterministic PRNG so every seed produces the same demo
let seed = 20261031;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

const counters: Record<string, number> = { QT: 0, SUB: 0, INV: 0, PAY: 0 };
const num = (key: 'QT' | 'SUB' | 'INV' | 'PAY', date: Date) => `${key}-${date.getUTCFullYear()}-${String(++counters[key]).padStart(6, '0')}`;

const monthsAgo = (n: number, day?: number) => {
  const dt = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - n, 1));
  const dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  return dateOnly(dt.getUTCFullYear(), dt.getUTCMonth() + 1, Math.min(day ?? TODAY.getUTCDate(), dim));
};

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

type LineSpec = { kind: 'PLAN'; qty: number; disc?: number } | { kind: 'PRODUCT'; product: string; variant?: string; qty: number; disc?: number };

async function main() {
  console.log(`Seeding Brightloop demo data (business date ${formatDateOnly(TODAY)}, ${TZ})…`);
  await wipe();

  // ───────── Settings ─────────
  const settings: Record<string, string> = {
    companyName: 'Brightloop Software',
    companyAddress: '4th Floor, Hazratganj Business Centre, Lucknow, Uttar Pradesh 226001, India',
    companyEmail: 'billing@brightloop.example',
    companyTaxId: '09ABCDE1234F1Z5',
    currency: 'INR',
    timezone: TZ,
    invoiceDueDays: '15',
    autoConfirmRecurringInvoices: 'false',
    quotationValidityDays: '30',
  };
  await prisma.setting.createMany({ data: Object.entries(settings).map(([key, value]) => ({ key, value })) });

  // ───────── Users (DEMO CREDENTIALS — development only) ─────────
  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const admin = await prisma.user.create({ data: { name: 'Ananya Iyer', email: 'admin@brightloop.demo', role: 'ADMIN', passwordHash: hash('Admin@12345'), phone: '+91 98390 10001' } });
  const staff = await prisma.user.create({ data: { name: 'Rohan Gupta', email: 'staff@brightloop.demo', role: 'STAFF', passwordHash: hash('Staff@12345'), phone: '+91 98390 10002' } });
  await prisma.user.create({ data: { name: 'Meera Joshi', email: 'meera.staff@brightloop.demo', role: 'STAFF', passwordHash: hash('Staff@12345'), status: 'INACTIVE' } });

  // ───────── Taxes ─────────
  const gst18 = await prisma.taxRule.create({ data: { name: 'GST 18%', rate: '18', isDefault: true, description: 'Standard rate for software and services' } });
  const gst12 = await prisma.taxRule.create({ data: { name: 'GST 12%', rate: '12', description: 'Reduced rate' } });
  await prisma.taxRule.create({ data: { name: 'GST 5%', rate: '5' } });
  const zero = await prisma.taxRule.create({ data: { name: 'Zero rated (export)', rate: '0', description: 'Exports of services' } });
  const taxRate: Record<string, string> = { [gst18.id]: '18', [gst12.id]: '12', [zero.id]: '0' };

  // ───────── Products & variants ─────────
  const productDefs = [
    { key: 'pos', name: 'Brightloop POS', productType: 'Software', salesPrice: '2000', costPrice: '600', description: 'Point-of-sale suite for retail counters', tax: gst18.id, variants: [{ key: 'odoo', attribute: 'Brand', name: 'Odoo', priceAdjustment: '560' }, { key: 'generic', attribute: 'Brand', name: 'Generic', priceAdjustment: '0' }] },
    { key: 'inv', name: 'Inventory Cloud', productType: 'Software', salesPrice: '1500', costPrice: '400', description: 'Multi-warehouse stock management', tax: gst18.id, variants: [{ key: 'std', attribute: 'Edition', name: 'Standard', priceAdjustment: '0' }, { key: 'pro', attribute: 'Edition', name: 'Professional', priceAdjustment: '750' }] },
    { key: 'analytics', name: 'Advanced Analytics', productType: 'Add-on', salesPrice: '499', costPrice: '90', description: 'Dashboards and scheduled reports add-on', tax: gst18.id, variants: [] },
    { key: 'support', name: 'Priority Support', productType: 'Service', salesPrice: '999', costPrice: '350', description: '4-hour response, dedicated account manager', tax: gst18.id, variants: [] },
    { key: 'payroll', name: 'Payroll Connector', productType: 'Add-on', salesPrice: '349', costPrice: '70', description: 'Sync with payroll providers', tax: gst12.id, variants: [] },
    { key: 'fax', name: 'Legacy Fax Gateway', productType: 'Add-on', salesPrice: '199', costPrice: '60', description: 'Retired — kept for historical invoices', tax: gst18.id, variants: [], status: 'ARCHIVED' as const },
  ];
  const products: Record<string, { id: string; name: string; price: string; tax: string; variants: Record<string, { id: string; name: string; attribute: string; adj: string }> }> = {};
  for (const p of productDefs) {
    const created = await prisma.product.create({
      data: {
        name: p.name,
        productType: p.productType,
        salesPrice: p.salesPrice,
        costPrice: p.costPrice,
        description: p.description,
        taxRuleId: p.tax,
        status: p.status ?? 'ACTIVE',
        variants: { create: p.variants.map(({ key: _k, ...v }) => v) },
      },
      include: { variants: true },
    });
    products[p.key] = {
      id: created.id,
      name: created.name,
      price: p.salesPrice,
      tax: p.tax,
      variants: Object.fromEntries(
        p.variants.map((v) => {
          const cv = created.variants.find((x) => x.name === v.name)!;
          return [v.key, { id: cv.id, name: cv.name, attribute: cv.attribute, adj: v.priceAdjustment }];
        }),
      ),
    };
  }

  // ───────── Plans ─────────
  const planDefs = [
    { key: 'daily', name: 'Daily Pass', description: 'Pay-as-you-go access for pop-up stores and events', billingFrequency: 'DAILY', price: '49', minQuantity: 1, termLength: 30, autoClose: true, autoRenew: false, allowPause: false, allowEarlyClose: true, allowRenew: true },
    { key: 'weekly', name: 'Weekly Starter', description: 'Flexible weekly billing for small shops', billingFrequency: 'WEEKLY', price: '299', minQuantity: 1, termLength: 26, autoClose: true, autoRenew: false, allowPause: true, allowEarlyClose: true, allowRenew: true },
    { key: 'monthly', name: 'Growth Monthly', description: 'Most popular — monthly plan per seat', billingFrequency: 'MONTHLY', price: '999', minQuantity: 1, termLength: null, autoClose: false, autoRenew: false, allowPause: true, allowEarlyClose: true, allowRenew: true },
    { key: 'yearly', name: 'Business Yearly', description: 'Annual contract per seat, minimum 5 seats', billingFrequency: 'YEARLY', price: '9999', minQuantity: 5, termLength: 1, autoClose: true, autoRenew: true, allowPause: false, allowEarlyClose: false, allowRenew: true },
    { key: 'enterprise', name: 'Enterprise Annual', description: 'Large organisations, 10+ seats, billed yearly', billingFrequency: 'YEARLY', price: '24999', minQuantity: 10, termLength: 1, autoClose: false, autoRenew: true, allowPause: false, allowEarlyClose: false, allowRenew: true },
  ] as const;
  const plans: Record<string, { id: string; name: string; price: string; freq: BillingFrequency; minQuantity: number; termLength: number | null; autoRenew: boolean; autoClose: boolean }> = {};
  for (const p of planDefs) {
    const { key, ...rest } = p;
    const created = await prisma.subscriptionPlan.create({ data: { ...rest, availableFrom: monthsAgo(18, 1), taxRuleId: gst18.id } });
    plans[key] = { id: created.id, name: created.name, price: p.price, freq: p.billingFrequency, minQuantity: p.minQuantity, termLength: p.termLength, autoRenew: p.autoRenew, autoClose: p.autoClose };
  }
  await prisma.subscriptionPlan.create({
    data: { name: 'Legacy Monthly (retired)', billingFrequency: 'MONTHLY', price: '799', availableFrom: monthsAgo(30, 1), availableUntil: monthsAgo(12, 1), status: 'ARCHIVED', taxRuleId: gst18.id },
  });
  await prisma.subscriptionPlan.create({
    data: { name: 'Festive Season Special', description: 'Limited-time quarterly offer (launches next month)', billingFrequency: 'MONTHLY', billingInterval: 3, price: '2499', availableFrom: addDays(TODAY, 30), availableUntil: addDays(TODAY, 120), termLength: 2, status: 'ACTIVE', taxRuleId: gst18.id },
  });

  // ───────── Discounts ─────────
  const discounts = [
    await prisma.discount.create({ data: { code: 'SEATS10', name: '10% off for 10+ seats', description: 'Volume discount applied automatically', type: 'PERCENTAGE', value: '10', minQuantity: 10, startsAt: monthsAgo(14, 1), usageLimit: 500, scope: 'ALL', autoApply: true } }),
    await prisma.discount.create({ data: { code: 'POSODOO5', name: '5% off Brightloop POS', description: 'Product discount on POS lines', type: 'PERCENTAGE', value: '5', startsAt: monthsAgo(6, 1), endsAt: addDays(TODAY, 90), scope: 'PRODUCT', productId: products.pos.id, autoApply: true } }),
    await prisma.discount.create({ data: { code: 'WELCOME500', name: '₹500 welcome credit', description: 'Manual code for new customers, orders over ₹5,000', type: 'FIXED', value: '500', minPurchase: '5000', startsAt: monthsAgo(3, 1), endsAt: addDays(TODAY, 60), usageLimit: 50, scope: 'ALL', autoApply: false } }),
    await prisma.discount.create({ data: { code: 'FESTIVE15', name: 'Festive 15% (ended)', type: 'PERCENTAGE', value: '15', startsAt: monthsAgo(3, 1), endsAt: monthsAgo(2, 15), scope: 'ALL', autoApply: true, minPurchase: '3000' } }),
    await prisma.discount.create({ data: { code: 'LAUNCH20', name: 'Launch week 20% (capped at 3 uses)', type: 'PERCENTAGE', value: '20', startsAt: monthsAgo(11, 1), usageLimit: 3, scope: 'PLAN', planId: plans.monthly.id, autoApply: true } }),
  ];
  const usage: Record<string, number> = {};
  const discountRules = (): DiscountRule[] =>
    discounts.map((x) => ({
      id: x.id, type: x.type, value: x.value, status: x.status, startsAt: x.startsAt, endsAt: x.endsAt, usageLimit: x.usageLimit,
      usedCount: usage[x.id] ?? 0, minPurchase: x.minPurchase, minQuantity: x.minQuantity, scope: x.scope,
      productId: x.productId, planId: x.planId, subscriptionId: x.subscriptionId,
    }));

  // ───────── Customers ─────────
  const customerA = await prisma.customer.create({
    data: { name: 'Aarav Sharma', companyName: 'Sharma Retail Pvt Ltd', email: 'customer@brightloop.demo', phone: '+91 94150 20001', addressLine1: '12 Aminabad Market', city: 'Lucknow', state: 'Uttar Pradesh', postalCode: '226018', country: 'India', taxId: '09AAACS1234A1Z1', billingContact: 'Accounts — Sharma Retail' },
  });
  const customerB = await prisma.customer.create({
    data: { name: 'Neha Kapoor', companyName: 'Kapoor Logistics LLP', email: 'customer.b@brightloop.demo', phone: '+91 98110 20002', addressLine1: 'Plot 44, Sector 63', city: 'Noida', state: 'Uttar Pradesh', postalCode: '201301', country: 'India', taxId: '09AAKFK5678B1Z2' },
  });
  const custPass = hash('Customer@123');
  const ua = await prisma.user.create({ data: { name: customerA.name, email: customerA.email, role: 'CUSTOMER', passwordHash: custPass, phone: customerA.phone } });
  const ub = await prisma.user.create({ data: { name: customerB.name, email: customerB.email, role: 'CUSTOMER', passwordHash: custPass, phone: customerB.phone } });
  await prisma.customer.update({ where: { id: customerA.id }, data: { userId: ua.id } });
  await prisma.customer.update({ where: { id: customerB.id }, data: { userId: ub.id } });

  const others = [
    ['Vikram Singh', 'Singh Hardware Mart', 'Kanpur'], ['Priya Nair', 'Coastal Spices Co', 'Kochi'], ['Arjun Reddy', 'Reddy Pharma Distributors', 'Hyderabad'],
    ['Kavya Menon', 'Menon Textiles', 'Coimbatore'], ['Siddharth Rao', 'Rao Electronics', 'Bengaluru'], ['Ishita Banerjee', 'Kolkata Book House', 'Kolkata'],
    ['Rahul Mehta', 'Mehta Supermarket', 'Ahmedabad'], ['Sneha Patil', 'Patil Agro Foods', 'Pune'], ['Aditya Verma', 'Verma Auto Parts', 'Lucknow'],
    ['Pooja Agarwal', 'Agarwal Sweets', 'Varanasi'], ['Karan Malhotra', 'Malhotra Fitness Studios', 'Chandigarh'], ['Divya Krishnan', 'Krishnan Clinics', 'Chennai'],
    ['Manish Tiwari', 'Tiwari Stationers', 'Prayagraj'], ['Ritu Saxena', 'Saxena Home Decor', 'Agra'], ['Nikhil Joshi', 'Joshi Cold Storage', 'Nagpur'],
    ['Ayesha Khan', 'Khan Leather Works', 'Kanpur'], ['Gaurav Bhatt', 'Bhatt Travels', 'Dehradun'], ['Tanvi Desai', 'Desai Jewellers', 'Surat'],
    ['Harsh Vardhan', 'Vardhan Infra Ltd', 'Gurugram'], ['Lakshmi Iyer', 'Iyer Organics', 'Mysuru'], ['Omkar Kulkarni', 'Kulkarni Dairy', 'Kolhapur'],
    ['Zoya Siddiqui', 'Lucknow Chikan Emporium', 'Lucknow'],
  ];
  const customers = [customerA, customerB];
  for (const [i, [name, company, city]] of others.entries()) {
    customers.push(
      await prisma.customer.create({
        data: {
          name,
          companyName: company,
          email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${company.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
          phone: `+91 9${String(800000000 + i * 7919).slice(0, 9)}`,
          addressLine1: `${10 + i} Main Road`,
          city,
          country: 'India',
          createdAt: monthsAgo(between(1, 13), between(1, 28)),
          status: i === 21 ? 'INACTIVE' : 'ACTIVE',
        },
      }),
    );
  }

  // ───────── Helpers to build priced lines ─────────
  const buildLines = (planKey: string, specs: LineSpec[]) => {
    const plan = plans[planKey];
    const resolved = specs.map((s) => {
      if (s.kind === 'PLAN') {
        return { type: 'PLAN' as const, planId: plan.id, productId: null, variantId: null, description: `${plan.name} — ${plan.freq.toLowerCase()} plan`, quantity: s.qty, unitPrice: plan.price, discountPercent: String(s.disc ?? 0), taxRuleId: gst18.id, taxRate: '18' };
      }
      const p = products[s.product];
      const v = s.variant ? p.variants[s.variant] : undefined;
      return {
        type: 'PRODUCT' as const,
        planId: null,
        productId: p.id,
        variantId: v?.id ?? null,
        description: v ? `${p.name} (${v.attribute}: ${v.name})` : p.name,
        quantity: s.qty,
        unitPrice: toMoneyString(d(p.price).plus(v?.adj ?? 0)),
        discountPercent: String(s.disc ?? 0),
        taxRuleId: p.tax,
        taxRate: taxRate[p.tax] ?? '18',
      };
    });
    const priced = priceDocument(resolved.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxRate: l.taxRate, discountEligible: false })));
    const rows = resolved.map((l, i) => ({
      ...l,
      discountPercent: d(l.discountPercent).toFixed(4),
      taxRate: d(l.taxRate).toFixed(4),
      lineSubtotal: toMoneyString(priced.lines[i].lineSubtotal),
      discountAmount: toMoneyString(priced.lines[i].discountAmount),
      taxAmount: toMoneyString(priced.lines[i].taxAmount),
      lineTotal: toMoneyString(priced.lines[i].lineTotal),
      sortOrder: i,
    }));
    return { rows, totals: { subtotal: toMoneyString(priced.subtotal), discountTotal: toMoneyString(priced.discountTotal), taxTotal: toMoneyString(priced.taxTotal), total: toMoneyString(priced.total) } };
  };

  const subLineData = (rows: ReturnType<typeof buildLines>['rows']) =>
    rows.map(({ type, planId: _p, ...l }) => ({ ...l, isPlanFee: type === 'PLAN' }));
  const quoteLineData = (rows: ReturnType<typeof buildLines>['rows']) => rows.map(({ type: _t, ...l }) => l);

  const methods: PaymentMethod[] = ['BANK_TRANSFER', 'UPI', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CASH'];
  const billTo = (c: (typeof customers)[number]) => ({
    billToName: c.companyName ? `${c.companyName} (${c.name})` : c.name,
    billToEmail: c.email,
    billToAddress: [c.addressLine1, c.city, c.state, c.postalCode, c.country].filter(Boolean).join(', ') || null,
    billToTaxId: c.taxId,
  });

  /** Creates one historical recurring invoice (with automatic discounts) and optionally payments. */
  async function historicalInvoice(
    sub: { id: string; number: string; customerId: string; planId: string; billingFrequency: BillingFrequency; billingInterval: number; billingAnchorDay: number; paymentTermsDays: number },
    lines: ReturnType<typeof buildLines>['rows'],
    customer: (typeof customers)[number],
    periodStart: Date,
    pay: 'FULL' | 'PARTIAL' | 'NONE' | 'DRAFT' | 'CANCEL',
  ) {
    const ctxLines = lines.map((l) => ({ productId: l.productId, quantity: l.quantity, netAmount: d(l.lineSubtotal).minus(d(l.lineSubtotal).mul(d(l.discountPercent)).div(100)).toDecimalPlaces(2) }));
    let best: { id: string; type: 'FIXED' | 'PERCENTAGE'; value: Prisma.Decimal | string; idx: number[]; amount: ReturnType<typeof d> } | null = null;
    for (const rule of discountRules()) {
      const src = discounts.find((x) => x.id === rule.id)!;
      if (!src.autoApply) continue;
      const r = evaluateDiscount(rule, { date: periodStart, planId: sub.planId, subscriptionId: sub.id, lines: ctxLines });
      if (r.eligible && (!best || r.amount.gt(best.amount))) best = { id: rule.id, type: rule.type, value: src.value, idx: r.eligibleLineIndexes, amount: r.amount };
    }
    const priced = priceDocument(
      lines.map((l, i) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxRate: l.taxRate, discountEligible: best ? best.idx.includes(i) : false })),
      best ? { type: best.type, value: best.value } : null,
    );
    const { periodEnd } = billingPeriod(periodStart, sub.billingFrequency as Frequency, sub.billingInterval, sub.billingAnchorDay);
    const invoiceDate = periodStart;
    const dueDate = addDays(invoiceDate, sub.paymentTermsDays);
    const total = priced.total;
    const status = pay === 'DRAFT' ? 'DRAFT' : pay === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
    const inv = await prisma.invoice.create({
      data: {
        number: num('INV', invoiceDate),
        customerId: customer.id,
        subscriptionId: sub.id,
        source: 'RECURRING',
        status,
        invoiceDate,
        dueDate,
        periodStart,
        periodEnd,
        billingPeriodKey: `${sub.id}:${formatDateOnly(periodStart)}`,
        currency: 'INR',
        discountId: best?.id ?? null,
        subtotal: toMoneyString(priced.subtotal),
        discountTotal: toMoneyString(priced.discountTotal),
        taxTotal: toMoneyString(priced.taxTotal),
        total: toMoneyString(total),
        amountPaid: '0.00',
        balanceDue: pay === 'CANCEL' ? '0.00' : toMoneyString(total),
        ...billTo(customer),
        confirmedAt: status === 'CONFIRMED' ? invoiceDate : null,
        sentAt: status === 'CONFIRMED' ? invoiceDate : null,
        cancelledAt: pay === 'CANCEL' ? addDays(invoiceDate, 2) : null,
        cancellationReason: pay === 'CANCEL' ? 'Raised in error — customer moved to annual billing' : null,
        notes: `Subscription ${sub.number} · service period ${formatDateOnly(periodStart)} to ${formatDateOnly(periodEnd)}`,
        createdAt: invoiceDate,
        lines: {
          create: lines.map((l, i) => ({
            productId: l.productId, variantId: l.variantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
            discountPercent: l.discountPercent, taxRuleId: l.taxRuleId, taxRate: l.taxRate,
            lineSubtotal: toMoneyString(priced.lines[i].lineSubtotal), discountAmount: toMoneyString(priced.lines[i].discountAmount),
            taxAmount: toMoneyString(priced.lines[i].taxAmount), lineTotal: toMoneyString(priced.lines[i].lineTotal), sortOrder: i,
          })),
        },
      },
    });
    if (best && pay !== 'CANCEL') {
      usage[best.id] = (usage[best.id] ?? 0) + 1;
      await prisma.discountUsage.create({ data: { discountId: best.id, customerId: customer.id, invoiceId: inv.id, amount: toMoneyString(priced.documentDiscount), usedAt: invoiceDate } });
    }
    if (pay === 'FULL' || pay === 'PARTIAL') {
      const amount = pay === 'FULL' ? total : total.mul(between(30, 60)).div(100).toDecimalPlaces(0);
      const payDate = addDays(invoiceDate, between(1, Math.max(1, sub.paymentTermsDays - 1)));
      const payDateCapped = payDate > TODAY ? TODAY : payDate;
      await prisma.payment.create({
        data: {
          number: num('PAY', payDateCapped),
          customerId: customer.id,
          method: pick(methods),
          amount: toMoneyString(amount),
          paymentDate: payDateCapped,
          reference: `REF${formatDateOnly(payDateCapped).replace(/-/g, '')}${String(counters.PAY).padStart(5, '0')}`,
          notes: pay === 'PARTIAL' ? 'Part payment — balance promised next week' : null,
          recordedById: rand() > 0.5 ? staff.id : admin.id,
          createdAt: payDateCapped,
          allocations: { create: [{ invoiceId: inv.id, amount: toMoneyString(amount) }] },
        },
      });
      const paid = d(amount);
      const st = invoiceStatusFromPayments(total, paid);
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { amountPaid: toMoneyString(paid), balanceDue: toMoneyString(total.minus(paid)), status: st, paidAt: st === 'PAID' ? payDateCapped : null },
      });
    }
    return inv;
  }

  async function event(subscriptionId: string, type: string, message: string, at: Date, from?: string, to?: string, actorId: string | null = staff.id) {
    await prisma.subscriptionEvent.create({ data: { subscriptionId, type, message, fromStatus: from ?? null, toStatus: to ?? null, actorId, createdAt: at } });
  }

  /**
   * Creates a subscription and its billing history up to today.
   * leaveDue → the latest due period is left un-invoiced so the billing preview has work to do.
   */
  async function makeSubscription(opts: {
    customer: (typeof customers)[number];
    plan: keyof typeof plans;
    specs: LineSpec[];
    start: Date;
    status: 'DRAFT' | 'QUOTATION' | 'CONFIRMED' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
    closeReason?: 'EXPIRED' | 'CLOSED_EARLY' | 'CANCELLED';
    leaveDue?: boolean;
    latest?: 'DRAFT' | 'PARTIAL' | 'NONE';
    notes?: string;
    endOverride?: Date | null;
    pausedAfterPeriods?: number;
  }) {
    const plan = plans[opts.plan];
    const { rows, totals } = buildLines(opts.plan, opts.specs);
    const anchor = opts.start.getUTCDate();
    const end =
      opts.endOverride !== undefined
        ? opts.endOverride
        : plan.termLength
          ? addDays(addBillingPeriods(opts.start, plan.freq as Frequency, 1, anchor, plan.termLength), -1)
          : null;
    const sub = await prisma.subscription.create({
      data: {
        number: num('SUB', opts.start),
        customerId: opts.customer.id,
        planId: plan.id,
        status: opts.status,
        startDate: opts.start,
        endDate: end,
        billingFrequency: plan.freq,
        billingInterval: 1,
        billingAnchorDay: anchor,
        paymentTermsDays: 15,
        autoRenew: plan.autoRenew,
        autoClose: plan.autoClose,
        currency: 'INR',
        ...totals,
        notes: opts.notes ?? null,
        createdById: rand() > 0.4 ? staff.id : admin.id,
        confirmedAt: ['CONFIRMED', 'ACTIVE', 'PAUSED', 'CLOSED'].includes(opts.status) ? addDays(opts.start, -2) : null,
        activatedAt: ['ACTIVE', 'PAUSED', 'CLOSED'].includes(opts.status) && opts.closeReason !== 'CANCELLED' ? opts.start : null,
        createdAt: addDays(opts.start, -3),
        lines: { create: subLineData(rows) },
      },
    });
    await event(sub.id, 'CREATED', 'Subscription created as draft', addDays(opts.start, -3), undefined, 'DRAFT');
    if (['CONFIRMED', 'ACTIVE', 'PAUSED', 'CLOSED'].includes(opts.status) && opts.closeReason !== 'CANCELLED') {
      await event(sub.id, 'STATUS_CHANGED', 'Subscription confirmed', addDays(opts.start, -2), 'DRAFT', 'CONFIRMED');
    }
    if (opts.status === 'QUOTATION') await event(sub.id, 'STATUS_CHANGED', 'Quotation sent to the customer', addDays(opts.start, -2), 'DRAFT', 'QUOTATION');

    if (!['ACTIVE', 'PAUSED', 'CLOSED'].includes(opts.status) || opts.closeReason === 'CANCELLED') {
      if (opts.closeReason === 'CANCELLED') {
        await prisma.subscription.update({ where: { id: sub.id }, data: { closedAt: addDays(opts.start, -1), closeReason: 'CANCELLED' } });
        await event(sub.id, 'STATUS_CHANGED', 'Cancelled: customer chose a different plan', addDays(opts.start, -1), 'DRAFT', 'CLOSED');
      }
      return sub;
    }
    await event(sub.id, 'STATUS_CHANGED', `Subscription activated; first billing date ${formatDateOnly(opts.start)}`, opts.start, 'CONFIRMED', 'ACTIVE');

    // billing history
    const periods: Date[] = [];
    let cursor = opts.start;
    const stopAt = opts.status === 'CLOSED' && end ? (end < TODAY ? end : TODAY) : TODAY;
    while (cursor <= stopAt && (!end || cursor <= end) && periods.length < 400) {
      periods.push(cursor);
      cursor = addBillingPeriods(cursor, plan.freq as Frequency, 1, anchor);
    }
    if (opts.pausedAfterPeriods !== undefined) periods.splice(opts.pausedAfterPeriods);
    if (opts.leaveDue && periods.length > 1) periods.pop();
    let next: Date | null = periods.length ? addBillingPeriods(periods[periods.length - 1], plan.freq as Frequency, 1, anchor) : opts.start;
    for (const [i, p] of periods.entries()) {
      const isLast = i === periods.length - 1;
      const age = (TODAY.getTime() - p.getTime()) / 86_400_000;
      let pay: 'FULL' | 'PARTIAL' | 'NONE' | 'DRAFT' = 'FULL';
      if (isLast && opts.latest) pay = opts.latest;
      else if (age < 20) pay = rand() < 0.45 ? 'FULL' : rand() < 0.5 ? 'PARTIAL' : 'NONE';
      else if (age < 60) pay = rand() < 0.8 ? 'FULL' : rand() < 0.5 ? 'PARTIAL' : 'NONE';
      else pay = rand() < 0.95 ? 'FULL' : 'NONE';
      await historicalInvoice(sub, rows, opts.customer, p, pay);
    }
    if (periods.length) {
      await event(sub.id, 'INVOICED', `${periods.length} invoice(s) generated by recurring billing`, periods[periods.length - 1], undefined, undefined, null);
    }
    if (opts.status === 'PAUSED') {
      const pausedAt = addDays(periods[periods.length - 1] ?? opts.start, 3);
      await prisma.subscription.update({ where: { id: sub.id }, data: { pausedAt } });
      await event(sub.id, 'STATUS_CHANGED', 'Subscription paused: seasonal closure', pausedAt, 'ACTIVE', 'PAUSED');
    }
    if (opts.status === 'CLOSED') {
      next = null;
      const closedAt = opts.closeReason === 'EXPIRED' && end ? addDays(end, 1) : addDays(periods[periods.length - 1] ?? opts.start, 10);
      await prisma.subscription.update({ where: { id: sub.id }, data: { closedAt, closeReason: opts.closeReason ?? 'EXPIRED' } });
      await event(sub.id, 'STATUS_CHANGED', opts.closeReason === 'EXPIRED' ? 'Closed automatically at the end of its term' : 'Closed early: customer request', closedAt, 'ACTIVE', 'CLOSED', opts.closeReason === 'EXPIRED' ? null : staff.id);
    }
    await prisma.subscription.update({ where: { id: sub.id }, data: { nextBillingDate: next } });
    return sub;
  }

  // ───────── Customer A — Sharma Retail ─────────
  const aMain = await makeSubscription({
    customer: customerA, plan: 'monthly', start: monthsAgo(9, 5), status: 'ACTIVE', latest: 'PARTIAL',
    specs: [{ kind: 'PLAN', qty: 3 }, { kind: 'PRODUCT', product: 'pos', variant: 'odoo', qty: 2 }, { kind: 'PRODUCT', product: 'analytics', qty: 1 }],
    notes: 'Main store and two counters',
  });
  await makeSubscription({
    customer: customerA, plan: 'weekly', start: addDays(TODAY, -70), status: 'PAUSED', pausedAfterPeriods: 6,
    specs: [{ kind: 'PLAN', qty: 1 }, { kind: 'PRODUCT', product: 'payroll', qty: 1 }], notes: 'Seasonal kiosk at Janpath',
  });
  await makeSubscription({
    customer: customerA, plan: 'monthly', start: addDays(TODAY, 7), status: 'DRAFT',
    specs: [{ kind: 'PLAN', qty: 1 }, { kind: 'PRODUCT', product: 'inv', variant: 'std', qty: 1 }], notes: 'New warehouse — pending scope confirmation',
  });

  // ───────── Customer B — Kapoor Logistics ─────────
  await makeSubscription({
    customer: customerB, plan: 'yearly', start: monthsAgo(4, 12), status: 'ACTIVE', latest: 'NONE',
    specs: [{ kind: 'PLAN', qty: 5 }, { kind: 'PRODUCT', product: 'support', qty: 1 }], notes: 'Annual contract — fleet operations',
  });
  await makeSubscription({
    customer: customerB, plan: 'weekly', start: monthsAgo(9, 3), status: 'CLOSED', closeReason: 'EXPIRED',
    specs: [{ kind: 'PLAN', qty: 2 }],
  });
  await makeSubscription({
    customer: customerB, plan: 'daily', start: addDays(TODAY, -12), status: 'ACTIVE', leaveDue: true,
    specs: [{ kind: 'PLAN', qty: 4 }], notes: 'Temporary depot at Ghaziabad',
  });

  // ───────── Other customers — a realistic spread ─────────
  const scenario: Parameters<typeof makeSubscription>[0][] = [];
  const rest = customers.slice(2, 23);
  rest.forEach((c, i) => {
    const r = i % 7;
    if (r === 0) scenario.push({ customer: c, plan: 'enterprise', start: monthsAgo(between(2, 11), between(1, 28)), status: 'ACTIVE', specs: [{ kind: 'PLAN', qty: between(10, 25) }, { kind: 'PRODUCT', product: 'support', qty: 1 }, { kind: 'PRODUCT', product: 'analytics', qty: 10 }] });
    if (r === 1) scenario.push({ customer: c, plan: 'monthly', start: monthsAgo(between(3, 12), between(1, 28)), status: 'ACTIVE', leaveDue: i % 2 === 0, specs: [{ kind: 'PLAN', qty: between(1, 4) }, { kind: 'PRODUCT', product: 'pos', variant: pick(['odoo', 'generic']), qty: between(1, 3) }] });
    if (r === 2) scenario.push({ customer: c, plan: 'monthly', start: monthsAgo(between(1, 10), between(1, 28)), status: 'ACTIVE', specs: [{ kind: 'PLAN', qty: between(10, 14) }, { kind: 'PRODUCT', product: 'inv', variant: 'pro', qty: 1 }] });
    if (r === 3) scenario.push({ customer: c, plan: 'yearly', start: monthsAgo(between(1, 11), between(1, 28)), status: 'ACTIVE', latest: i % 2 ? 'NONE' : undefined, specs: [{ kind: 'PLAN', qty: between(5, 8) }] });
    if (r === 4) scenario.push({ customer: c, plan: 'weekly', start: addDays(TODAY, -between(20, 80)), status: 'ACTIVE', leaveDue: true, specs: [{ kind: 'PLAN', qty: 1 }, { kind: 'PRODUCT', product: 'analytics', qty: 1 }] });
    if (r === 5) scenario.push({ customer: c, plan: 'monthly', start: monthsAgo(between(6, 12), between(1, 28)), status: 'CLOSED', closeReason: 'CLOSED_EARLY', endOverride: null, specs: [{ kind: 'PLAN', qty: 2 }], pausedAfterPeriods: between(2, 4) });
    if (r === 6) scenario.push({ customer: c, plan: 'monthly', start: monthsAgo(between(1, 8), between(1, 28)), status: 'ACTIVE', latest: 'DRAFT', specs: [{ kind: 'PLAN', qty: between(1, 3) }, { kind: 'PRODUCT', product: 'support', qty: 1 }] });
  });
  for (const s of scenario) await makeSubscription(s);
  // Pipeline states
  await makeSubscription({ customer: customers[5], plan: 'enterprise', start: addDays(TODAY, 3), status: 'CONFIRMED', specs: [{ kind: 'PLAN', qty: 12 }, { kind: 'PRODUCT', product: 'support', qty: 1 }], notes: 'Signed — go-live next week' });
  const quoSub = await makeSubscription({ customer: customers[8], plan: 'monthly', start: addDays(TODAY, 10), status: 'QUOTATION', specs: [{ kind: 'PLAN', qty: 2 }, { kind: 'PRODUCT', product: 'pos', variant: 'odoo', qty: 1 }] });
  await makeSubscription({ customer: customers[10], plan: 'weekly', start: addDays(TODAY, -5), status: 'CLOSED', closeReason: 'CANCELLED', specs: [{ kind: 'PLAN', qty: 1 }] });

  // A cancelled invoice and a manual one-off invoice for completeness
  {
    const c = customers[3];
    const { rows } = buildLines('monthly', [{ kind: 'PRODUCT', product: 'support', qty: 1 }]);
    await historicalInvoice(
      { id: aMain.id, number: aMain.number, customerId: customerA.id, planId: plans.monthly.id, billingFrequency: 'MONTHLY', billingInterval: 1, billingAnchorDay: aMain.billingAnchorDay, paymentTermsDays: 15 },
      rows, customerA, monthsAgo(7, 20), 'CANCEL',
    );
    const priced = priceDocument([{ quantity: 1, unitPrice: '4999', taxRate: '18' }]);
    await prisma.invoice.create({
      data: {
        number: num('INV', addDays(TODAY, -40)), customerId: c.id, source: 'MANUAL', status: 'CONFIRMED',
        invoiceDate: addDays(TODAY, -40), dueDate: addDays(TODAY, -25), currency: 'INR',
        subtotal: toMoneyString(priced.subtotal), taxTotal: toMoneyString(priced.taxTotal), total: toMoneyString(priced.total), balanceDue: toMoneyString(priced.total),
        ...billTo(c), confirmedAt: addDays(TODAY, -40), notes: 'One-off onboarding & data migration',
        lines: { create: [{ productId: products.support.id, description: 'Onboarding & data migration (one-off)', quantity: 1, unitPrice: '4999.00', taxRuleId: gst18.id, taxRate: '18.0000', lineSubtotal: '4999.00', taxAmount: toMoneyString(priced.taxTotal), lineTotal: toMoneyString(priced.total) }] },
      },
    });
  }

  // ───────── Quotation templates ─────────
  await prisma.quotationTemplate.create({
    data: {
      name: 'Retail Starter Bundle', description: 'Growth Monthly + Odoo-branded POS', validityDays: 15, planId: plans.monthly.id,
      terms: 'Prices in INR, exclusive of GST unless stated. Billing monthly in advance. Cancel any time with 30 days notice.',
      lines: { create: [{ planId: plans.monthly.id, quantity: 1, sortOrder: 0 }, { productId: products.pos.id, variantId: products.pos.variants.odoo.id, quantity: 1, sortOrder: 1 }] },
    },
  });
  await prisma.quotationTemplate.create({
    data: {
      name: 'Enterprise Annual Offer', description: '10 seats, priority support and analytics', validityDays: 30, planId: plans.enterprise.id,
      terms: 'Annual contract billed yearly in advance. 18% GST applies. Renews automatically unless cancelled 30 days before the end of term.',
      lines: { create: [{ planId: plans.enterprise.id, quantity: 10, sortOrder: 0 }, { productId: products.support.id, quantity: 1, sortOrder: 1 }, { productId: products.analytics.id, quantity: 10, sortOrder: 2 }] },
    },
  });

  // ───────── Quotations in different states ─────────
  async function quote(c: (typeof customers)[number], planKey: string, specs: LineSpec[], status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED', date: Date, extra: Partial<Prisma.QuotationUncheckedCreateInput> = {}) {
    const { rows, totals } = buildLines(planKey, specs);
    return prisma.quotation.create({
      data: {
        number: num('QT', date), customerId: c.id, planId: plans[planKey].id, quotationDate: date, validityDays: 30, validUntil: addDays(date, 30), status, currency: 'INR', ...totals,
        terms: 'Prices in INR. GST as applicable. Valid for 30 days.', sentAt: status !== 'DRAFT' ? date : null,
        respondedAt: ['ACCEPTED', 'REJECTED'].includes(status) ? addDays(date, 3) : null, createdById: staff.id, createdAt: date,
        lines: { create: quoteLineData(rows) }, ...extra,
      },
    });
  }
  await quote(customerA, 'monthly', [{ kind: 'PLAN', qty: 2 }, { kind: 'PRODUCT', product: 'inv', variant: 'pro', qty: 1 }], 'SENT', addDays(TODAY, -4), { notes: 'Expansion to the Gomti Nagar branch' });
  await quote(customerA, 'monthly', [{ kind: 'PLAN', qty: 1 }, { kind: 'PRODUCT', product: 'pos', variant: 'odoo', qty: 1 }], 'ACCEPTED', addDays(TODAY, -6), { notes: 'Accepted on call — ready to convert' });
  await quote(customerB, 'enterprise', [{ kind: 'PLAN', qty: 10 }, { kind: 'PRODUCT', product: 'support', qty: 1 }], 'REJECTED', addDays(TODAY, -50), { rejectionReason: 'Budget approval deferred to next financial year' });
  await quote(customers[4], 'yearly', [{ kind: 'PLAN', qty: 6 }], 'EXPIRED', addDays(TODAY, -60));
  await quote(customers[6], 'monthly', [{ kind: 'PLAN', qty: 12 }, { kind: 'PRODUCT', product: 'analytics', qty: 12 }], 'DRAFT', addDays(TODAY, -1), { notes: 'Volume deal — SEATS10 should apply' });
  // quotation linked to the subscription in QUOTATION state
  {
    const s = await prisma.subscription.findUniqueOrThrow({ where: { id: quoSub.id }, include: { lines: true } });
    await prisma.quotation.create({
      data: {
        number: num('QT', addDays(TODAY, -2)), customerId: s.customerId, planId: s.planId, subscriptionId: s.id, quotationDate: addDays(TODAY, -2), validityDays: 30, validUntil: addDays(TODAY, 28), status: 'SENT', currency: 'INR',
        subtotal: s.subtotal, discountTotal: s.discountTotal, taxTotal: s.taxTotal, total: s.total, sentAt: addDays(TODAY, -2), createdById: staff.id,
        lines: { create: s.lines.map((l) => ({ planId: l.isPlanFee ? s.planId : null, productId: l.productId, variantId: l.variantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxRuleId: l.taxRuleId, taxRate: l.taxRate, lineSubtotal: l.lineSubtotal, discountAmount: l.discountAmount, taxAmount: l.taxAmount, lineTotal: l.lineTotal, sortOrder: l.sortOrder })) },
      },
    });
  }

  // ───────── Change request (pending) ─────────
  const bYearly = await prisma.subscription.findFirstOrThrow({ where: { customerId: customerB.id, status: 'ACTIVE', planId: plans.yearly.id } });
  await prisma.changeRequest.create({ data: { subscriptionId: bYearly.id, customerId: customerB.id, type: 'RENEW', message: 'Please renew for another year at the same seat count.', createdAt: addDays(TODAY, -1) } });

  // ───────── Finalise counters ─────────
  for (const [id, used] of Object.entries(usage)) await prisma.discount.update({ where: { id }, data: { usedCount: used } });
  for (const [key, value] of Object.entries(counters)) await prisma.sequence.create({ data: { key, value } });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: 'DEMO_DATA_SEEDED', entityType: 'System', details: { businessDate: formatDateOnly(TODAY) } } });

  const [subs, invs, pays] = await Promise.all([prisma.subscription.count(), prisma.invoice.count(), prisma.payment.count()]);
  console.log(`✔ Seeded ${customers.length} customers, ${subs} subscriptions, ${invs} invoices, ${pays} payments.`);
  console.log('\nDemo logins (development only):');
  console.log('  Admin      admin@brightloop.demo       Admin@12345');
  console.log('  Staff      staff@brightloop.demo       Staff@12345');
  console.log('  Customer A customer@brightloop.demo    Customer@123');
  console.log('  Customer B customer.b@brightloop.demo  Customer@123\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
