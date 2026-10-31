import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { intervalLabel, isoDate, money, todayIso } from '@/lib/format';
import { useAction, useOptions } from '@/lib/hooks';
import type { Plan, SubscriptionStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader } from '@/components/ui/feedback';
import { BackLink } from '@/components/layout/AppShell';
import { LinesEditor, toLineInputs, type LinesValue } from '@/components/LinesEditor';
import { CustomerPicker } from '@/components/CustomerPicker';

interface Existing {
  id: string;
  number: string;
  status: SubscriptionStatus;
  customerId: string;
  planId: string;
  startDate: string;
  endDate: string | null;
  paymentTermsDays: number;
  autoRenew: boolean;
  autoClose: boolean;
  notes: string | null;
  discountId: string | null;
  lines: Parameters<typeof toLineInputs>[0];
}

export default function SubscriptionEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const plans = useOptions<Plan>('plans', '/plans', editing ? {} : { status: 'ACTIVE' });
  const existing = useQuery({ queryKey: ['subscription', id], queryFn: () => api.get<{ data: Existing }>(`/subscriptions/${id}`), enabled: editing });

  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [planId, setPlanId] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState(15);
  const [autoRenew, setAutoRenew] = useState<boolean | undefined>();
  const [autoClose, setAutoClose] = useState<boolean | undefined>();
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LinesValue>({ lines: [], discountId: null });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const s = existing.data?.data;
    if (!s) return;
    setCustomerId(s.customerId);
    setPlanId(s.planId);
    setStartDate(isoDate(s.startDate));
    setEndDate(isoDate(s.endDate));
    setPaymentTermsDays(s.paymentTermsDays);
    setAutoRenew(s.autoRenew);
    setAutoClose(s.autoClose);
    setNotes(s.notes ?? '');
    setLines({ lines: toLineInputs(s.lines), discountId: s.discountId });
  }, [existing.data]);

  const plan = plans.data?.data.find((p) => p.id === planId) ?? null;
  const status = existing.data?.data.status;
  const draft = !editing || status === 'DRAFT' || status === 'QUOTATION';

  // selecting a plan on a new subscription adds the plan line automatically
  useEffect(() => {
    if (!editing && plan && !lines.lines.some((l) => l.type === 'PLAN')) {
      setLines((v) => ({ ...v, lines: [{ type: 'PLAN', quantity: plan.minQuantity, discountPercent: '0' }, ...v.lines] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  const save = useAction(
    () => {
      const cleanLines = lines.lines.filter((l) => l.type === 'PLAN' || l.productId);
      const body = editing
        ? {
            ...(draft ? { planId, startDate } : {}),
            endDate: endDate || null,
            paymentTermsDays,
            autoRenew,
            autoClose,
            notes: notes || null,
            lines: cleanLines,
            discountId: lines.discountId,
          }
        : { customerId, planId, startDate, endDate: endDate || null, paymentTermsDays, autoRenew, autoClose, notes: notes || null, lines: cleanLines, discountId: lines.discountId };
      return editing ? api.patch<{ data: { id: string } }>(`/subscriptions/${id}`, body) : api.post<{ data: { id: string } }>('/subscriptions', body);
    },
    { success: editing ? 'Subscription updated' : 'Draft subscription created', invalidate: [['subscriptions'], ['subscription', id]], onSuccess: (r) => navigate(`/subscriptions/${r.data.id}`) },
  );

  if (editing && existing.isLoading) return <PageLoader />;
  if (editing && existing.error) return <ErrorState error={existing.error} />;
  if (status === 'CLOSED') return <ErrorState error={new Error('Closed subscriptions cannot be edited.')} />;

  const missing = !customerId ? 'Select a customer' : !planId ? 'Select a plan' : !lines.lines.some((l) => l.type === 'PLAN' || l.productId) ? 'Add at least one line' : endDate && endDate < startDate ? 'End date must be after the start date' : null;

  return (
    <>
      <PageHeader
        back={<BackLink to={editing ? `/subscriptions/${id}` : '/subscriptions'}>{editing ? existing.data?.data.number : 'Subscriptions'}</BackLink>}
        title={editing ? `Edit ${existing.data?.data.number}` : 'New subscription'}
        description={editing && !draft ? 'This subscription is already confirmed: line changes apply from the next invoice. Plan and start date are fixed.' : 'Creates a draft. Confirm and activate it when the customer has agreed.'}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Contract" />
          <CardBody className="grid gap-4 md:grid-cols-3">
            <Field label="Customer" required error={touched && !customerId ? 'Select a customer' : undefined}>
              {(p) => <CustomerPicker {...p} value={customerId} onChange={setCustomerId} disabled={editing} />}
            </Field>
            <Field label="Plan" required hint={plan ? `${intervalLabel(plan.billingFrequency, plan.billingInterval)} · ${money(plan.price)}/unit${plan.termLength ? ` · ${plan.termLength}-period term` : ''}` : undefined}>
              {(p) => (
                <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={!draft}>
                  <option value="">Select a plan…</option>
                  {plans.data?.data.filter((pl) => pl.status === 'ACTIVE' || pl.id === planId).map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Payment terms (days)" hint="Invoice due date = invoice date + terms">
              {(p) => <Input {...p} type="number" min={0} max={180} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} />}
            </Field>
            <Field label="Start date" required>{(p) => <Input {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!draft} />}</Field>
            <Field label="Expiry date" hint={plan?.termLength ? 'Blank = calculated from the plan term' : 'Blank = open-ended'}>
              {(p) => <Input {...p} type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
            </Field>
            <div className="space-y-3 pt-6">
              <Checkbox label="Renew automatically at expiry" checked={autoRenew ?? plan?.autoRenew ?? false} onChange={(e) => setAutoRenew(e.target.checked)} />
              <Checkbox label="Close automatically at expiry" checked={autoClose ?? plan?.autoClose ?? true} onChange={(e) => setAutoClose(e.target.checked)} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lines" description="The recurring amount billed every period. Automatic discounts are evaluated again on each invoice." />
          <CardBody>
            <LinesEditor plan={plan} value={lines} onChange={setLines} date={draft ? startDate : undefined} subscriptionId={id} existing={editing && !draft} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Notes" />
          <CardBody>
            <Textarea aria-label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </CardBody>
        </Card>
        <div className="flex items-center justify-end gap-3">
          {touched && missing && <p className="text-sm text-rose-600">{missing}</p>}
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => { setTouched(true); if (!missing) save.mutate(); }}>
            {editing ? 'Save changes' : 'Create draft'}
          </Button>
        </div>
      </div>
    </>
  );
}
