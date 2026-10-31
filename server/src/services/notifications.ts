import { prisma } from '../lib/prisma';
import { getSettings } from '../lib/settings';
import { formatDateOnly } from '../domain/dates';
import { renderCommercialPdf, pdfMoney } from './pdf';
import { sendEmail } from './email';
import { env } from '../config/env';

const human = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export async function invoicePdf(invoiceId: string) {
  const settings = await getSettings();
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: { orderBy: { sortOrder: 'asc' } }, subscription: { select: { number: true } }, discount: { select: { code: true } } },
  });
  const meta: [string, string][] = [
    ['Invoice date', formatDateOnly(inv.invoiceDate)],
    ['Due date', formatDateOnly(inv.dueDate)],
  ];
  if (inv.subscription) meta.push(['Subscription', inv.subscription.number]);
  if (inv.periodStart && inv.periodEnd) meta.push(['Period', `${formatDateOnly(inv.periodStart)} – ${formatDateOnly(inv.periodEnd)}`]);
  const buffer = await renderCommercialPdf(
    {
      kind: 'INVOICE',
      number: inv.number,
      status: human(inv.status),
      currency: inv.currency,
      meta,
      billTo: { name: inv.billToName, email: inv.billToEmail, address: inv.billToAddress, taxId: inv.billToTaxId },
      lines: inv.lines,
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      taxTotal: inv.taxTotal,
      total: inv.total,
      amountPaid: inv.amountPaid,
      balanceDue: inv.balanceDue,
      discountLabel: inv.discount?.code ?? null,
      notes: inv.notes,
      terms: `Payment due within the agreed payment terms. Please quote ${inv.number} with your payment.`,
    },
    settings,
  );
  return { buffer, filename: `${inv.number}.pdf`, invoice: inv };
}

export async function quotationPdf(quotationId: string) {
  const settings = await getSettings();
  const q = await prisma.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: { lines: { orderBy: { sortOrder: 'asc' } }, customer: true, discount: { select: { code: true } } },
  });
  const plan = q.planId ? await prisma.subscriptionPlan.findUnique({ where: { id: q.planId }, select: { name: true, billingFrequency: true } }) : null;
  const address = [q.customer.addressLine1, q.customer.addressLine2, q.customer.city, q.customer.state, q.customer.postalCode, q.customer.country]
    .filter(Boolean)
    .join(', ');
  const meta: [string, string][] = [
    ['Date', formatDateOnly(q.quotationDate)],
    ['Valid until', formatDateOnly(q.validUntil)],
  ];
  if (plan) meta.push(['Plan', `${plan.name} (${human(plan.billingFrequency)})`]);
  const buffer = await renderCommercialPdf(
    {
      kind: 'QUOTATION',
      number: q.number,
      status: human(q.status),
      currency: q.currency,
      meta,
      billTo: {
        name: q.customer.companyName ? `${q.customer.companyName} (${q.customer.name})` : q.customer.name,
        email: q.customer.email,
        address: address || null,
        taxId: q.customer.taxId,
      },
      lines: q.lines,
      subtotal: q.subtotal,
      discountTotal: q.discountTotal,
      taxTotal: q.taxTotal,
      total: q.total,
      discountLabel: q.discount?.code ?? null,
      notes: q.notes,
      terms: q.terms,
    },
    settings,
  );
  return { buffer, filename: `${q.number}.pdf`, quotation: q };
}

export async function notifyInvoice(invoiceId: string) {
  const { buffer, filename, invoice } = await invoicePdf(invoiceId);
  const settings = await getSettings();
  await sendEmail({
    to: invoice.billToEmail,
    subject: `Invoice ${invoice.number} from ${settings.companyName}`,
    text: [
      `Hello ${invoice.billToName},`,
      '',
      `Please find attached invoice ${invoice.number} for ${pdfMoney(invoice.total, invoice.currency)}.`,
      `Amount due: ${pdfMoney(invoice.balanceDue, invoice.currency)} by ${formatDateOnly(invoice.dueDate)}.`,
      '',
      `You can view and download your invoices any time in the customer portal: ${env.APP_URL}/portal/invoices`,
      '',
      `Thank you,`,
      settings.companyName,
    ].join('\n'),
    attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
  });
  await prisma.invoice.update({ where: { id: invoiceId }, data: { sentAt: new Date() } });
}

export async function notifyQuotation(quotationId: string) {
  const { buffer, filename, quotation } = await quotationPdf(quotationId);
  const settings = await getSettings();
  await sendEmail({
    to: quotation.customer.email,
    subject: `Quotation ${quotation.number} from ${settings.companyName}`,
    text: [
      `Hello ${quotation.customer.name},`,
      '',
      `Thank you for your interest. Please find attached quotation ${quotation.number} for ${pdfMoney(quotation.total, quotation.currency)}.`,
      `This quotation is valid until ${formatDateOnly(quotation.validUntil)}.`,
      '',
      `You can review and accept it in the customer portal: ${env.APP_URL}/portal/quotations`,
      '',
      `Kind regards,`,
      settings.companyName,
    ].join('\n'),
    attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
  });
}
