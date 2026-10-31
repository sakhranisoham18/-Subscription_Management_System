import PDFDocument from 'pdfkit';
import { d, type MoneyInput } from '../domain/money';
import type { AppSettings } from '../lib/settings';

const NAVY = '#0f1b3d';
const ACCENT = '#4f46e5';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';

/** PDFs use the currency code (e.g. "INR 1,234.00") because the built-in PDF fonts lack the ₹ glyph. */
export function pdfMoney(value: MoneyInput, currency: string) {
  const n = d(value).toFixed(2);
  const [int, frac] = n.split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  // en-IN digit grouping (12,34,567.00) for INR, standard grouping otherwise
  let grouped: string;
  if (currency === 'INR' && digits.length > 3) {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  } else {
    grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return `${neg ? '-' : ''}${currency} ${grouped}.${frac}`;
}

const fmtDate = (date: Date | null | undefined) =>
  date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

export interface PdfLine {
  description: string;
  quantity: number;
  unitPrice: MoneyInput;
  discountAmount: MoneyInput;
  taxRate: MoneyInput;
  taxAmount: MoneyInput;
  lineTotal: MoneyInput;
}

export interface CommercialDocument {
  kind: 'INVOICE' | 'QUOTATION';
  number: string;
  status: string;
  currency: string;
  meta: [string, string][];
  billTo: { name: string; email: string; address?: string | null; taxId?: string | null };
  lines: PdfLine[];
  subtotal: MoneyInput;
  discountTotal: MoneyInput;
  taxTotal: MoneyInput;
  total: MoneyInput;
  amountPaid?: MoneyInput;
  balanceDue?: MoneyInput;
  discountLabel?: string | null;
  notes?: string | null;
  terms?: string | null;
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, settings: AppSettings, title: string) {
  doc.rect(0, 0, doc.page.width, 6).fill(ACCENT);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(settings.companyName, 50, 40);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(settings.companyAddress, 50, 62, { width: 280 });
  doc.text(`${settings.companyEmail}  ·  GSTIN ${settings.companyTaxId}`, 50, doc.y + 2, { width: 280 });
  doc.font('Helvetica-Bold').fontSize(22).fillColor(NAVY).text(title, 330, 40, { width: 215, align: 'right' });
}

export async function renderCommercialPdf(input: CommercialDocument, settings: AppSettings): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${input.kind} ${input.number}`, Author: settings.companyName } });
  header(doc, settings, input.kind === 'INVOICE' ? 'TAX INVOICE' : 'QUOTATION');

  doc.font('Helvetica').fontSize(10).fillColor(NAVY);
  let y = 72;
  const metaRows: [string, string][] = [['Number', input.number], ...input.meta, ['Status', input.status]];
  for (const [k, v] of metaRows) {
    doc.fillColor(MUTED).text(k, 290, y, { width: 100, align: 'right' });
    doc.fillColor(NAVY).font('Helvetica-Bold').text(v, 395, y, { width: 150, align: 'right', lineBreak: false });
    doc.font('Helvetica');
    y += 15;
  }

  // Bill-to
  y = Math.max(y, 120) + 15;
  doc.fillColor(MUTED).fontSize(8).text(input.kind === 'INVOICE' ? 'BILL TO' : 'PREPARED FOR', 50, y);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(input.billTo.name, 50, y + 12);
  doc.font('Helvetica').fontSize(9).fillColor(NAVY);
  doc.text(input.billTo.email, 50, doc.y + 1);
  if (input.billTo.address) doc.text(input.billTo.address, 50, doc.y + 1, { width: 260 });
  if (input.billTo.taxId) doc.text(`Tax ID: ${input.billTo.taxId}`, 50, doc.y + 1);

  // Lines table
  y = doc.y + 20;
  const cols = [
    { label: 'Description', x: 50, w: 190, align: 'left' as const },
    { label: 'Qty', x: 240, w: 35, align: 'right' as const },
    { label: 'Unit price', x: 275, w: 75, align: 'right' as const },
    { label: 'Discount', x: 350, w: 60, align: 'right' as const },
    { label: 'Tax', x: 410, w: 55, align: 'right' as const },
    { label: 'Amount', x: 465, w: 80, align: 'right' as const },
  ];
  doc.rect(50, y, 495, 20).fill('#f1f5f9');
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
  cols.forEach((c) => doc.text(c.label.toUpperCase(), c.x + 4, y + 6, { width: c.w - 8, align: c.align }));
  y += 24;
  doc.font('Helvetica').fontSize(9).fillColor(NAVY);
  for (const line of input.lines) {
    const h = Math.max(doc.heightOfString(line.description, { width: cols[0].w - 8 }), 11) + 8;
    if (y + h > doc.page.height - 160) {
      doc.addPage();
      y = 50;
    }
    const values = [
      line.description,
      String(line.quantity),
      pdfMoney(line.unitPrice, input.currency),
      d(line.discountAmount).gt(0) ? `-${d(line.discountAmount).toFixed(2)}` : '—',
      `${d(line.taxRate).toFixed(2).replace(/\.00$/, '')}%`,
      pdfMoney(line.lineTotal, input.currency),
    ];
    cols.forEach((c, i) => doc.text(values[i], c.x + 4, y, { width: c.w - 8, align: c.align }));
    y += h;
    doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor(BORDER).lineWidth(0.5).stroke();
  }

  // Totals
  y += 8;
  const totals: [string, string, boolean?][] = [
    ['Subtotal', pdfMoney(input.subtotal, input.currency)],
    [
      `Discounts${input.discountLabel ? ` (${input.discountLabel})` : ''}`,
      `-${pdfMoney(input.discountTotal, input.currency)}`,
    ],
    ['Taxable amount', pdfMoney(d(input.subtotal).minus(d(input.discountTotal)), input.currency)],
    ['Tax', pdfMoney(input.taxTotal, input.currency)],
    ['Total', pdfMoney(input.total, input.currency), true],
  ];
  if (input.amountPaid !== undefined) totals.push(['Amount paid', pdfMoney(input.amountPaid, input.currency)]);
  if (input.balanceDue !== undefined) totals.push(['Balance due', pdfMoney(input.balanceDue, input.currency), true]);
  for (const [label, value, bold] of totals) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? NAVY : MUTED);
    doc.text(label, 300, y, { width: 140, align: 'right' });
    doc.fillColor(NAVY).text(value, 445, y, { width: 100, align: 'right' });
    y += bold ? 18 : 14;
  }

  y += 12;
  doc.font('Helvetica').fontSize(9);
  if (input.notes) {
    doc.fillColor(MUTED).font('Helvetica-Bold').text('Notes', 50, y);
    doc.font('Helvetica').fillColor(NAVY).text(input.notes, 50, doc.y + 2, { width: 495 });
    y = doc.y + 10;
  }
  if (input.terms) {
    doc.fillColor(MUTED).font('Helvetica-Bold').text('Terms & conditions', 50, y);
    doc.font('Helvetica').fillColor(NAVY).text(input.terms, 50, doc.y + 2, { width: 495 });
  }

  // Footer sits inside the bottom margin: lift the margin while drawing so PDFKit doesn't add a blank page.
  const footerY = doc.page.height - 40;
  doc.page.margins.bottom = 0;
  doc.fontSize(8).fillColor(MUTED).text(
    `${settings.companyName} · Subscription Management System · Generated ${fmtDate(new Date())}`,
    50,
    footerY,
    { width: 495, align: 'center', lineBreak: false },
  );
  return toBuffer(doc);
}

export interface ReportPdfInput {
  title: string;
  periodLabel: string;
  currency: string;
  kpis: [string, string][];
  tables: { title: string; columns: string[]; rows: string[][] }[];
  definitions: string[];
}

export async function renderReportPdf(input: ReportPdfInput, settings: AppSettings): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: input.title, Author: settings.companyName } });
  header(doc, settings, 'REPORT');
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text(input.title, 50, 120);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(input.periodLabel, 50, doc.y + 2);

  let y = doc.y + 16;
  const colW = 495 / 3;
  input.kpis.forEach(([label, value], i) => {
    const x = 50 + (i % 3) * colW;
    if (i % 3 === 0 && i > 0) y += 52;
    doc.roundedRect(x + 2, y, colW - 6, 46, 4).strokeColor(BORDER).lineWidth(0.8).stroke();
    doc.fillColor(MUTED).fontSize(8).text(label.toUpperCase(), x + 10, y + 8, { width: colW - 20 });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(value, x + 10, y + 24, { width: colW - 20 });
    doc.font('Helvetica');
  });
  y += 66;

  for (const table of input.tables) {
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = 50;
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(table.title, 50, y);
    y = doc.y + 6;
    const w = 495 / table.columns.length;
    doc.rect(50, y, 495, 18).fill('#f1f5f9');
    doc.fillColor(MUTED).fontSize(8);
    table.columns.forEach((c, i) => doc.text(c.toUpperCase(), 54 + i * w, y + 5, { width: w - 8, align: i === 0 ? 'left' : 'right' }));
    y += 22;
    doc.font('Helvetica').fontSize(9).fillColor(NAVY);
    if (!table.rows.length) {
      doc.fillColor(MUTED).text('No data for this period', 54, y);
      y += 16;
    }
    for (const row of table.rows) {
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = 50;
      }
      row.forEach((v, i) => doc.text(v, 54 + i * w, y, { width: w - 8, align: i === 0 ? 'left' : 'right' }));
      y += 15;
    }
    y += 14;
  }

  if (input.definitions.length) {
    if (y > doc.page.height - 140) {
      doc.addPage();
      y = 50;
    }
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Definitions', 50, y);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    input.definitions.forEach((t) => doc.text(`• ${t}`, 50, doc.y + 3, { width: 495 }));
  }
  return toBuffer(doc);
}
