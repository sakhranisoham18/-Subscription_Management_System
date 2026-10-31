import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { intervalLabel, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { Plan } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, Field, Input, Textarea } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';

export default function PortalPlans() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal-plans'], queryFn: () => api.get<{ data: Plan[] }>('/portal/plans') });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const request = useAction(() => api.post<{ data: { number: string; message: string } }>(`/portal/plans/${plan!.id}/request-quote`, { quantity, message: message || null }), {
    success: (r) => `${r.data.message} (${r.data.number})`,
    invalidate: [['portal-quotations']],
    onSuccess: () => { setPlan(null); setMessage(''); },
  });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <>
      <PageHeader title="Browse plans" description="Choose a plan and request a quotation — our team will confirm the details." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.data.map((p) => (
          <Card key={p.id}>
            <CardBody className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">{p.name}</h2>
                <Badge tone="indigo">{intervalLabel(p.billingFrequency, p.billingInterval)}</Badge>
              </div>
              <p className="mt-3 text-3xl font-semibold tabular">{money(p.price)}<span className="text-sm font-normal text-muted"> / unit / {p.billingFrequency.toLowerCase().replace('ly', '').replace('dai', 'day')}</span></p>
              {p.description && <p className="mt-2 text-sm text-ink-soft">{p.description}</p>}
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-soft">
                <li className="flex gap-2"><Check className="mt-0.5 size-4 text-emerald-600" /> Minimum quantity {p.minQuantity}</li>
                {p.termLength && <li className="flex gap-2"><Check className="mt-0.5 size-4 text-emerald-600" /> {p.termLength}-period term</li>}
                {p.allowPause && <li className="flex gap-2"><Check className="mt-0.5 size-4 text-emerald-600" /> Pause on request</li>}
                {p.allowRenew && <li className="flex gap-2"><Check className="mt-0.5 size-4 text-emerald-600" /> Easy renewal</li>}
              </ul>
              <Button className="mt-5" onClick={() => { setPlan(p); setQuantity(p.minQuantity); }}>Request a quotation</Button>
            </CardBody>
          </Card>
        ))}
        {!data.data.length && <p className="text-sm text-muted">No plans are available right now.</p>}
      </div>
      <Dialog
        open={Boolean(plan)}
        onOpenChange={(o) => !o && setPlan(null)}
        title={`Request a quotation — ${plan?.name}`}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setPlan(null)}>Cancel</Button><Button loading={request.isPending} disabled={!plan || quantity < plan.minQuantity} onClick={() => request.mutate()}>Send request</Button></>}
      >
        <div className="space-y-4">
          <Field label="Quantity (seats)" hint={`Minimum ${plan?.minQuantity}`}>{(p) => <Input {...p} type="number" min={plan?.minQuantity} value={quantity} onChange={(e) => setQuantity(Math.floor(Number(e.target.value) || 1))} />}</Field>
          <Field label="Message (optional)">{(p) => <Textarea {...p} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
        </div>
      </Dialog>
    </>
  );
}
