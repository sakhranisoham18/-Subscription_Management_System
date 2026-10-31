import type { ReactNode } from 'react';
import { money, percent } from '@/lib/format';
import type { DocLine } from '@/lib/types';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

export function DocLinesTable({ lines }: { lines: DocLine[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Description</Th>
          <Th className="text-right">Qty</Th>
          <Th className="text-right">Unit price</Th>
          <Th className="text-right">Discount</Th>
          <Th className="text-right">Tax</Th>
          <Th className="text-right">Amount</Th>
        </Tr>
      </THead>
      <TBody>
        {lines.map((l, i) => (
          <Tr key={l.id ?? i}>
            <Td>
              <p className="font-medium">{l.description}</p>
              {Number(l.discountPercent) > 0 && <p className="text-xs text-muted">Line discount {percent(l.discountPercent)}</p>}
            </Td>
            <Td className="text-right tabular">{l.quantity}</Td>
            <Td className="text-right tabular">{money(l.unitPrice)}</Td>
            <Td className="text-right tabular text-emerald-700">{Number(l.discountAmount) > 0 ? `−${money(l.discountAmount)}` : '—'}</Td>
            <Td className="text-right tabular text-ink-soft">
              {money(l.taxAmount)} <span className="text-xs">({percent(l.taxRate)})</span>
            </Td>
            <Td className="text-right font-medium tabular">{money(l.lineTotal)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

export function Totals({
  subtotal,
  discountTotal,
  taxTotal,
  total,
  discountLabel,
  extra,
}: {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  discountLabel?: string | null;
  extra?: [ReactNode, ReactNode, boolean?][];
}) {
  return (
    <dl className="ml-auto w-full max-w-xs space-y-2 p-5 text-sm">
      <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{money(subtotal)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted">Discounts{discountLabel ? ` (${discountLabel})` : ''}</dt><dd className="tabular text-emerald-700">−{money(discountTotal)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted">Taxable amount</dt><dd className="tabular">{money(Number(subtotal) - Number(discountTotal))}</dd></div>
      <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular">{money(taxTotal)}</dd></div>
      <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{money(total)}</dd></div>
      {extra?.map(([k, v, strong], i) => (
        <div key={i} className={`flex justify-between ${strong ? 'text-base font-semibold' : ''}`}><dt className={strong ? '' : 'text-muted'}>{k}</dt><dd className="tabular">{v}</dd></div>
      ))}
    </dl>
  );
}
