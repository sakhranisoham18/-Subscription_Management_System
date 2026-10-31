import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useDebounced, useOptions } from '@/lib/hooks';
import type { LineInput, Plan, Pricing, Product, TaxRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/primitives';

export interface LinesValue {
  lines: LineInput[];
  discountId: string | null;
}

interface EligibleDiscount {
  id: string;
  code: string;
  name: string;
  eligible: boolean;
  reason: string | null;
  amount: string | null;
}

/**
 * Line editor shared by quotations, subscriptions and manual invoices.
 * The browser only sends product/variant/plan ids, quantities and line discount %.
 * Every price, tax and total shown here comes from the server preview.
 */
export function LinesEditor({
  plan,
  value,
  onChange,
  date,
  subscriptionId,
  existing,
  allowPlanLines = true,
}: {
  plan?: Plan | null;
  value: LinesValue;
  onChange: (v: LinesValue) => void;
  date?: string;
  subscriptionId?: string;
  existing?: boolean;
  allowPlanLines?: boolean;
}) {
  const products = useOptions<Product>('products', '/products', { status: 'ACTIVE' });
  const taxes = useOptions<TaxRule>('taxes', '/taxes', { status: 'ACTIVE' });
  const lines = value.lines;
  const validLines = lines.filter((l) => l.type === 'PLAN' || l.productId);
  const payload = useDebounced(
    JSON.stringify({ planId: plan?.id ?? null, lines: validLines, discountId: value.discountId, date, subscriptionId, existing }),
    250,
  );

  // Enable queries from the SAME debounced payload they send (otherwise a stale, empty payload is posted and rejected).
  const sent = useMemo(() => JSON.parse(payload) as { planId: string | null; lines: LineInput[] }, [payload]);
  const queryable = sent.lines.length > 0 && (!sent.lines.some((l) => l.type === 'PLAN') || Boolean(sent.planId));
  const preview = useQuery({
    queryKey: ['pricing-preview', payload],
    queryFn: () => api.post<{ data: Pricing }>('/quotations/preview', JSON.parse(payload)),
    enabled: queryable,
    retry: false,
  });
  const eligibility = useQuery({
    queryKey: ['eligible-discounts', payload],
    queryFn: () => {
      const p = JSON.parse(payload);
      return api.post<{ data: EligibleDiscount[] }>('/discounts/eligible', { planId: p.planId, lines: p.lines, date: p.date, subscriptionId: p.subscriptionId });
    },
    enabled: queryable,
    retry: false,
  });

  const priced = preview.data?.data;
  const pricedByIndex = useMemo(() => {
    const map = new Map<number, Pricing['lines'][number]>();
    let j = 0;
    lines.forEach((l, i) => {
      if (l.type === 'PLAN' || l.productId) map.set(i, priced?.lines[j++] as Pricing['lines'][number]);
    });
    return map;
  }, [lines, priced]);

  const update = (i: number, patch: Partial<LineInput>) => onChange({ ...value, lines: lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const remove = (i: number) => onChange({ ...value, lines: lines.filter((_, idx) => idx !== i) });
  const add = (l: LineInput) => onChange({ ...value, lines: [...lines, l] });
  const previewError = preview.error instanceof ApiError ? preview.error.message : null;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="w-48 px-3 py-2">Variant</th>
              <th className="w-24 px-3 py-2 text-right">Qty</th>
              <th className="w-28 px-3 py-2 text-right">Unit price</th>
              <th className="w-24 px-3 py-2 text-right">Disc %</th>
              <th className="w-36 px-3 py-2">Tax</th>
              <th className="w-32 px-3 py-2 text-right">Amount</th>
              <th className="w-10"><span className="sr-only">Remove line</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l, i) => {
              const product = products.data?.data.find((p) => p.id === l.productId);
              const p = pricedByIndex.get(i);
              return (
                <tr key={i} className="align-top">
                  <td className="px-3 py-2">
                    {l.type === 'PLAN' ? (
                      <div className="py-1.5">
                        <p className="font-medium">{plan ? plan.name : 'Select a plan above'}</p>
                        <p className="text-xs text-muted">Plan fee{plan ? ` · min. qty ${plan.minQuantity}` : ''}</p>
                      </div>
                    ) : (
                      <Select aria-label="Product" value={l.productId ?? ''} onChange={(e) => update(i, { productId: e.target.value, variantId: null })}>
                        <option value="">Select a product…</option>
                        {products.data?.data.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name} — {money(pr.salesPrice)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {l.type === 'PRODUCT' && product && product.variants.filter((v) => v.status === 'ACTIVE').length > 0 ? (
                      <Select aria-label="Variant" value={l.variantId ?? ''} onChange={(e) => update(i, { variantId: e.target.value || null })}>
                        <option value="">Base product</option>
                        {product.variants
                          .filter((v) => v.status === 'ACTIVE')
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.attribute}: {v.name} ({Number(v.priceAdjustment) >= 0 ? '+' : ''}
                              {Number(v.priceAdjustment)})
                            </option>
                          ))}
                      </Select>
                    ) : (
                      <span className="block py-2 text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label="Quantity"
                      type="number"
                      min={1}
                      className="text-right tabular"
                      value={l.quantity}
                      onChange={(e) => update(i, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                    />
                  </td>
                  <td className="px-3 py-2 pt-4 text-right tabular text-ink-soft">{p ? money(p.unitPrice) : '—'}</td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label="Line discount percent"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className="text-right tabular"
                      value={l.discountPercent ?? '0'}
                      onChange={(e) => update(i, { discountPercent: e.target.value === '' ? '0' : String(Math.min(100, Math.max(0, Number(e.target.value)))) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select aria-label="Tax rule" value={l.taxRuleId ?? ''} onChange={(e) => update(i, { taxRuleId: e.target.value || null })}>
                      <option value="">Auto{p ? ` (${Number(p.taxRate)}%)` : ''}</option>
                      {taxes.data?.data.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2 pt-4 text-right">
                    <span className="font-medium tabular">{p ? money(p.lineTotal) : '—'}</span>
                    {p && Number(p.discountAmount) > 0 && <span className="block text-xs text-emerald-600">−{money(p.discountAmount)}</span>}
                  </td>
                  <td className="px-1 py-2">
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => remove(i)}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted">
                  No lines yet — add the plan and any products.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {allowPlanLines && (
          <Button type="button" variant="secondary" size="sm" disabled={!plan} onClick={() => add({ type: 'PLAN', quantity: plan?.minQuantity ?? 1, discountPercent: '0' })}>
            <Plus /> Plan line
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => add({ type: 'PRODUCT', productId: '', variantId: null, quantity: 1, discountPercent: '0' })}>
          <Plus /> Product line
        </Button>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_320px]">
        <div>
          <label className="text-sm font-medium" htmlFor="discount-picker">
            Discount rule
          </label>
          <Select id="discount-picker" className="mt-1.5" value={value.discountId ?? ''} onChange={(e) => onChange({ ...value, discountId: e.target.value || null })}>
            <option value="">No discount rule</option>
            {eligibility.data?.data.map((d) => (
              <option key={d.id} value={d.id} disabled={!d.eligible}>
                {d.code} — {d.name}
                {d.eligible ? ` (saves ${money(d.amount)})` : ` — ${d.reason}`}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-muted">Only eligible rules can be selected. Discounts apply before tax.</p>
          {previewError && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {previewError}
            </p>
          )}
        </div>
        <dl className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm" aria-live="polite">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{money(priced?.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Discounts{priced?.discount ? ` (${priced.discount.code})` : ''}</dt><dd className="tabular text-emerald-700">−{money(priced?.discountTotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular">{money(priced?.taxTotal)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{preview.isFetching ? '…' : money(priced?.total)}</dd></div>
        </dl>
      </div>
    </div>
  );
}

/** Converts stored document lines into editor input lines. */
export function toLineInputs(lines: { planId?: string | null; isPlanFee?: boolean; productId: string | null; variantId: string | null; quantity: number; discountPercent: string; taxRuleId: string | null }[]): LineInput[] {
  return lines.map((l) =>
    l.planId || l.isPlanFee
      ? { type: 'PLAN', quantity: l.quantity, discountPercent: String(Number(l.discountPercent)), taxRuleId: l.taxRuleId }
      : { type: 'PRODUCT', productId: l.productId ?? '', variantId: l.variantId, quantity: l.quantity, discountPercent: String(Number(l.discountPercent)), taxRuleId: l.taxRuleId },
  );
}
