import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { addDaysIso, date, isoDate, todayIso, intervalLabel, money } from '@/lib/format';
import { useAction, useOptions } from '@/lib/hooks';
import type { Plan, LineInput } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader } from '@/components/ui/feedback';
import { BackLink } from '@/components/layout/AppShell';
import { LinesEditor, toLineInputs, type LinesValue } from '@/components/LinesEditor';
import { CustomerPicker } from '@/components/CustomerPicker';

interface Template {
  id: string;
  name: string;
  validityDays: number;
  planId: string;
  terms: string | null;
  notes: string | null;
  lines: { planId: string | null; productId: string | null; variantId: string | null; quantity: number; taxRuleId: string | null }[];
}

export default function QuotationEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const plans = useOptions<Plan>('plans', '/plans', { status: 'ACTIVE' });
  const templates = useQuery({ queryKey: ['templates', 'ACTIVE'], queryFn: () => api.get<{ data: Template[] }>('/templates', { status: 'ACTIVE' }) });
  const existing = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get<{ data: { customerId: string; planId: string; templateId: string | null; quotationDate: string; validityDays: number; notes: string | null; terms: string | null; discountId: string | null; status: string; lines: Parameters<typeof toLineInputs>[0] } }>(`/quotations/${id}`),
    enabled: editing,
  });

  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [planId, setPlanId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [quotationDate, setQuotationDate] = useState(todayIso());
  const [validityDays, setValidityDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<LinesValue>({ lines: [], discountId: null });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const q = existing.data?.data;
    if (!q) return;
    setCustomerId(q.customerId);
    setPlanId(q.planId);
    setTemplateId(q.templateId ?? '');
    setQuotationDate(isoDate(q.quotationDate));
    setValidityDays(q.validityDays);
    setNotes(q.notes ?? '');
    setTerms(q.terms ?? '');
    setLines({ lines: toLineInputs(q.lines), discountId: q.discountId });
  }, [existing.data]);

  const applyTemplate = (tid: string) => {
    setTemplateId(tid);
    const t = templates.data?.data.find((x) => x.id === tid);
    if (!t) return;
    setPlanId(t.planId);
    setValidityDays(t.validityDays);
    setTerms(t.terms ?? '');
    if (t.notes) setNotes(t.notes);
    setLines({
      discountId: null,
      lines: t.lines.map<LineInput>((l) => (l.planId ? { type: 'PLAN', quantity: l.quantity, discountPercent: '0', taxRuleId: l.taxRuleId } : { type: 'PRODUCT', productId: l.productId!, variantId: l.variantId, quantity: l.quantity, discountPercent: '0', taxRuleId: l.taxRuleId })),
    });
  };

  const plan = plans.data?.data.find((p) => p.id === planId) ?? null;
  const save = useAction(
    () => {
      const body = {
        customerId,
        planId,
        templateId: templateId || null,
        quotationDate,
        validityDays,
        notes: notes || null,
        terms: terms || null,
        discountId: lines.discountId,
        lines: lines.lines.filter((l) => l.type === 'PLAN' || l.productId),
      };
      return editing ? api.patch<{ data: { id: string } }>(`/quotations/${id}`, body) : api.post<{ data: { id: string } }>('/quotations', body);
    },
    { success: editing ? 'Quotation updated' : 'Quotation created', invalidate: [['quotations'], ['quotation', id]], onSuccess: (r) => navigate(`/quotations/${r.data.id}`) },
  );

  if (editing && existing.isLoading) return <PageLoader />;
  if (editing && existing.error) return <ErrorState error={existing.error} />;
  if (editing && existing.data && existing.data.data.status !== 'DRAFT') return <ErrorState error={new Error('Only draft quotations can be edited. Revise it back to draft first.')} />;

  const missing = !customerId ? 'Select a customer' : !planId ? 'Select a plan' : !lines.lines.some((l) => l.type === 'PLAN' || l.productId) ? 'Add at least one line' : null;

  return (
    <>
      <PageHeader back={<BackLink to="/quotations">Quotations</BackLink>} title={editing ? 'Edit quotation' : 'New quotation'} description="Prices, discounts and taxes are calculated by the server from the catalogue." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="grid gap-4 md:grid-cols-3">
            <Field label="Start from a template" className="md:col-span-3" hint="Pre-fills the plan, standard lines, validity and terms.">
              {(p) => (
                <Select {...p} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">No template</option>
                  {templates.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name} · valid {t.validityDays} days</option>)}
                </Select>
              )}
            </Field>
            <Field label="Customer" required error={touched && !customerId ? 'Select a customer' : undefined}>
              {(p) => <CustomerPicker {...p} value={customerId} onChange={setCustomerId} />}
            </Field>
            <Field label="Plan" required error={touched && !planId ? 'Select a plan' : undefined} hint={plan ? `${intervalLabel(plan.billingFrequency, plan.billingInterval)} · ${money(plan.price)} per unit` : undefined}>
              {(p) => (
                <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Select a plan…</option>
                  {plans.data?.data.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quotation date">{(p) => <Input {...p} type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} />}</Field>
              <Field label="Valid (days)" hint={`Until ${date(addDaysIso(quotationDate, validityDays))}`}>
                {(p) => <Input {...p} type="number" min={1} max={365} value={validityDays} onChange={(e) => setValidityDays(Math.max(1, Number(e.target.value) || 1))} />}
              </Field>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lines" description="Plan fee and products/variants. Quantity × unit price, minus discounts, plus tax." />
          <CardBody>
            <LinesEditor plan={plan} value={lines} onChange={setLines} date={quotationDate} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Notes & terms" />
          <CardBody className="grid gap-4 md:grid-cols-2">
            <Field label="Notes (shown on the quotation)">{(p) => <Textarea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            <Field label="Terms & conditions">{(p) => <Textarea {...p} rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} />}</Field>
          </CardBody>
        </Card>
        <div className="flex items-center justify-end gap-3">
          {touched && missing && <p className="text-sm text-rose-600">{missing}</p>}
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!missing) save.mutate();
            }}
          >
            {editing ? 'Save changes' : 'Create quotation'}
          </Button>
        </div>
      </div>
    </>
  );
}
