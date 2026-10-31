import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { intervalLabel, money } from '@/lib/format';
import { useAction, useOptions } from '@/lib/hooks';
import type { Plan, Product } from '@/lib/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

interface TLine {
  planId: string | null;
  productId: string | null;
  variantId: string | null;
  quantity: number;
  product: { name: string } | null;
  variant: { name: string; attribute: string } | null;
}
interface Template {
  id: string;
  name: string;
  description: string | null;
  validityDays: number;
  planId: string;
  terms: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  plan: { id: string; name: string; billingFrequency: string } | null;
  lines: TLine[];
}
interface EditLine {
  type: 'PLAN' | 'PRODUCT';
  productId: string;
  variantId: string;
  quantity: number;
}

function TemplateDialog({ open, onOpenChange, template }: { open: boolean; onOpenChange: (o: boolean) => void; template?: Template }) {
  const plans = useOptions<Plan>('plans', '/plans', { status: 'ACTIVE' });
  const products = useOptions<Product>('products', '/products', { status: 'ACTIVE' });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [validityDays, setValidity] = useState(30);
  const [planId, setPlanId] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<EditLine[]>([]);
  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setDescription(template?.description ?? '');
    setValidity(template?.validityDays ?? 30);
    setPlanId(template?.planId ?? '');
    setTerms(template?.terms ?? '');
    setLines(
      template?.lines.map((l) => ({ type: l.planId ? 'PLAN' : 'PRODUCT', productId: l.productId ?? '', variantId: l.variantId ?? '', quantity: l.quantity })) ?? [],
    );
  }, [open, template]);

  const plan = plans.data?.data.find((p) => p.id === planId);
  const save = useAction(
    () => {
      const body = {
        name,
        description: description || null,
        validityDays,
        planId,
        terms: terms || null,
        lines: lines.map((l) => (l.type === 'PLAN' ? { type: 'PLAN', quantity: l.quantity } : { type: 'PRODUCT', productId: l.productId, variantId: l.variantId || null, quantity: l.quantity })),
      };
      return template ? api.patch(`/templates/${template.id}`, body) : api.post('/templates', body);
    },
    { success: 'Template saved', invalidate: [['templates'], ['options']], onSuccess: () => onOpenChange(false) },
  );
  const update = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const valid = name.trim().length >= 2 && planId && lines.length > 0 && lines.every((l) => l.type === 'PLAN' || l.productId);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={template ? `Edit ${template.name}` : 'New quotation template'}
      description="Templates pre-fill the plan, standard lines, validity period and terms when a sales rep starts a quotation."
      size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Save template</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template name" required>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Valid for (days)" required>{(p) => <Input {...p} type="number" min={1} max={365} value={validityDays} onChange={(e) => setValidity(Math.max(1, Number(e.target.value) || 1))} />}</Field>
        <Field label="Plan" required className="sm:col-span-2" hint={plan ? `${intervalLabel(plan.billingFrequency, plan.billingInterval)} · ${money(plan.price)} per unit · min. qty ${plan.minQuantity}` : undefined}>
          {(p) => (
            <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select a plan…</option>
              {plans.data?.data.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Description" className="sm:col-span-2">{(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Standard lines</p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={!plan} onClick={() => setLines((l) => [...l, { type: 'PLAN', productId: '', variantId: '', quantity: plan?.minQuantity ?? 1 }])}><Plus /> Plan line</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setLines((l) => [...l, { type: 'PRODUCT', productId: '', variantId: '', quantity: 1 }])}><Plus /> Product line</Button>
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const product = products.data?.data.find((p) => p.id === l.productId);
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_90px_auto] items-center gap-2">
                  {l.type === 'PLAN' ? (
                    <p className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">{plan?.name ?? 'Plan'} <span className="text-xs text-muted">· plan fee</span></p>
                  ) : (
                    <>
                      <Select aria-label="Product" value={l.productId} onChange={(e) => update(i, { productId: e.target.value, variantId: '' })}>
                        <option value="">Select a product…</option>
                        {products.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                      <Select aria-label="Variant" value={l.variantId} onChange={(e) => update(i, { variantId: e.target.value })} disabled={!product?.variants.length}>
                        <option value="">Base product</option>
                        {product?.variants.filter((v) => v.status === 'ACTIVE').map((v) => <option key={v.id} value={v.id}>{v.attribute}: {v.name}</option>)}
                      </Select>
                    </>
                  )}
                  <Input aria-label="Quantity" type="number" min={1} value={l.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}><Trash2 /></Button>
                </div>
              );
            })}
            {!lines.length && <p className="rounded-lg bg-slate-50 p-3 text-xs text-muted">Add the plan line and any standard products.</p>}
          </div>
        </div>
        <Field label="Default terms & conditions" className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

export default function Templates() {
  const { can } = useAuth();
  const canWrite = can('templates:write');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['templates'], queryFn: () => api.get<{ data: Template[] }>('/templates') });
  const [dlg, setDlg] = useState<{ open: boolean; template?: Template }>({ open: false });
  const toggle = useAction((t: Template) => api.patch(`/templates/${t.id}`, { status: t.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }), { success: 'Template updated', invalidate: [['templates']] });
  return (
    <>
      <PageHeader
        title="Quotation templates"
        description="Reusable offers: plan, standard lines, validity and terms."
        actions={canWrite && <Button onClick={() => setDlg({ open: true })}><Plus /> New template</Button>}
      />
      <Card>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Template</Th><Th>Plan</Th><Th>Lines</Th><Th>Valid for</Th><Th>Status</Th>{canWrite && <Th className="w-32" />}</Tr></THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={6} rows={3} /> : data?.data.map((t) => (
                  <Tr key={t.id}>
                    <Td><p className="font-medium">{t.name}</p>{t.description && <p className="text-xs text-muted">{t.description}</p>}</Td>
                    <Td>{t.plan?.name ?? '—'}</Td>
                    <Td className="text-xs text-ink-soft">{t.lines.map((l) => `${l.quantity} × ${l.planId ? 'Plan fee' : `${l.product?.name}${l.variant ? ` (${l.variant.name})` : ''}`}`).join(', ')}</Td>
                    <Td>{t.validityDays} days</Td>
                    <Td><StatusBadge status={t.status} /></Td>
                    {canWrite && (
                      <Td className="text-right">
                        <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setDlg({ open: true, template: t })}><Pencil /></Button>
                        <Button variant="ghost" size="sm" onClick={() => toggle.mutate(t)}>{t.status === 'ACTIVE' ? 'Archive' : 'Restore'}</Button>
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={FileSignature} title="No templates yet" />}
          </>
        )}
      </Card>
      <TemplateDialog open={dlg.open} onOpenChange={(o) => setDlg({ open: o })} template={dlg.template} />
    </>
  );
}
