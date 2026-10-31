import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, FileText, Pencil, Repeat, RotateCcw, Send, XCircle } from 'lucide-react';
import { api, errorMessage, openFile } from '@/lib/api';
import { date, dateTime, intervalLabel, todayIso } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { DocLine, HistoryEntry, QuotationStatus } from '@/lib/types';
import { titleCase } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Field, Input } from '@/components/ui/primitives';
import { DescriptionList, ErrorState, PageHeader, PageLoader, StatusBadge, Timeline } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { BackLink } from '@/components/layout/AppShell';
import { DocLinesTable, Totals } from '@/components/DocLines';

interface Q {
  id: string;
  number: string;
  status: QuotationStatus;
  quotationDate: string;
  validUntil: string;
  validityDays: number;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  rejectionReason: string | null;
  customer: { id: string; name: string; companyName: string | null; email: string };
  template: { name: string } | null;
  discount: { code: string; name: string } | null;
  subscription: { id: string; number: string; status: string } | null;
  createdBy: { name: string } | null;
  plan: { name: string; billingFrequency: string; billingInterval: number } | null;
  lines: DocLine[];
  history: HistoryEntry[];
}

export default function QuotationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can('quotations:write');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['quotation', id], queryFn: () => api.get<{ data: Q }>(`/quotations/${id}`) });
  const inv = [['quotation', id], ['quotations']];
  const send = useAction(() => api.post(`/quotations/${id}/send`), { success: 'Quotation emailed to the customer (PDF attached)', invalidate: inv });
  const accept = useAction(() => api.post(`/quotations/${id}/accept`), { success: 'Marked as accepted', invalidate: inv });
  const revise = useAction(() => api.post(`/quotations/${id}/revise`), { success: 'Back to draft', invalidate: inv });
  const reject = useAction((reason: string) => api.post(`/quotations/${id}/reject`, { reason }), { success: 'Marked as rejected', invalidate: inv });
  const [rejecting, setRejecting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [terms, setTerms] = useState(15);
  const convert = useAction(() => api.post<{ data: { id: string } }>(`/quotations/${id}/convert`, { startDate, paymentTermsDays: terms }), {
    success: 'Subscription created and confirmed',
    invalidate: [...inv, ['subscriptions']],
    onSuccess: (r) => navigate(`/subscriptions/${r.data.id}`),
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const q = data.data;
  const expiredSoon = q.status === 'SENT' && q.validUntil.slice(0, 10) < todayIso();

  return (
    <>
      <PageHeader
        back={<BackLink to="/quotations">Quotations</BackLink>}
        title={<span className="flex items-center gap-3">{q.number} <StatusBadge status={q.status} /></span>}
        description={
          <>
            For <Link className="text-brand-600 hover:underline" to={`/customers/${q.customer.id}`}>{q.customer.companyName ?? q.customer.name}</Link> · valid until {date(q.validUntil)}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => openFile(`/quotations/${q.id}/pdf`).catch((e) => toast.error(errorMessage(e)))}><FileText /> PDF</Button>
            <Button variant="secondary" size="icon" aria-label="Download PDF" onClick={() => openFile(`/quotations/${q.id}/pdf?download=1`, { download: true })}><Download /></Button>
            {canWrite && q.status === 'DRAFT' && <Button variant="secondary" onClick={() => navigate(`/quotations/${q.id}/edit`)}><Pencil /> Edit</Button>}
            {canWrite && ['SENT', 'REJECTED', 'EXPIRED'].includes(q.status) && <Button variant="secondary" loading={revise.isPending} onClick={() => revise.mutate()}><RotateCcw /> Revise</Button>}
            {canWrite && ['DRAFT', 'SENT'].includes(q.status) && <Button variant="secondary" onClick={() => setRejecting(true)}><XCircle /> Rejected</Button>}
            {canWrite && ['DRAFT', 'SENT'].includes(q.status) && <Button variant="secondary" loading={accept.isPending} onClick={() => accept.mutate()}><CheckCircle2 /> Mark accepted</Button>}
            {canWrite && ['DRAFT', 'SENT'].includes(q.status) && <Button loading={send.isPending} onClick={() => send.mutate()}><Send /> {q.status === 'SENT' ? 'Resend' : 'Send to customer'}</Button>}
            {canWrite && q.status === 'ACCEPTED' && <Button onClick={() => setConverting(true)}><Repeat /> Convert to subscription</Button>}
            {q.subscription && <Button onClick={() => navigate(`/subscriptions/${q.subscription!.id}`)}><Repeat /> View {q.subscription.number}</Button>}
          </>
        }
      />
      {expiredSoon && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">This quotation has passed its validity date and will be marked expired by the next daily job.</p>}
      {q.status === 'REJECTED' && q.rejectionReason && <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">Rejected: {q.rejectionReason}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Lines" />
            <DocLinesTable lines={q.lines} />
            <Totals subtotal={q.subtotal} discountTotal={q.discountTotal} taxTotal={q.taxTotal} total={q.total} discountLabel={q.discount?.code} />
          </Card>
          {(q.notes || q.terms) && (
            <Card>
              <CardBody className="grid gap-6 md:grid-cols-2">
                <div><p className="text-xs font-medium uppercase tracking-wide text-muted">Notes</p><p className="mt-1 whitespace-pre-wrap text-sm">{q.notes ?? '—'}</p></div>
                <div><p className="text-xs font-medium uppercase tracking-wide text-muted">Terms</p><p className="mt-1 whitespace-pre-wrap text-sm">{q.terms ?? '—'}</p></div>
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <DescriptionList
                cols={1}
                items={[
                  ['Customer', `${q.customer.companyName ?? q.customer.name} (${q.customer.email})`],
                  ['Plan', q.plan ? `${q.plan.name} · ${intervalLabel(q.plan.billingFrequency, q.plan.billingInterval)}` : '—'],
                  ['Quotation date', date(q.quotationDate)],
                  ['Validity', `${q.validityDays} days (until ${date(q.validUntil)})`],
                  ['Template', q.template?.name ?? '—'],
                  ['Discount rule', q.discount ? `${q.discount.code} — ${q.discount.name}` : '—'],
                  ['Sent', q.sentAt ? dateTime(q.sentAt) : 'Not sent'],
                  ['Prepared by', q.createdBy?.name ?? 'Customer request (portal)'],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline items={q.history.map((h) => ({ id: h.id, title: titleCase(h.action.replace('QUOTATION_', '')), meta: `${h.actor?.name ?? 'System'} · ${dateTime(h.createdAt)}` }))} />
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={rejecting} onOpenChange={setRejecting} title="Mark quotation as rejected?" description="Record why the customer declined (optional)." reasonLabel="Reason" confirmLabel="Mark rejected" tone="danger" loading={reject.isPending} onConfirm={async (r) => { await reject.mutateAsync(r); setRejecting(false); }} />
      <Dialog
        open={converting}
        onOpenChange={setConverting}
        title="Convert to subscription"
        description="All lines, prices, discounts and taxes are copied to a new confirmed subscription."
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setConverting(false)}>Cancel</Button><Button loading={convert.isPending} onClick={() => convert.mutate()}>Create subscription</Button></>}
      >
        <div className="space-y-4">
          <Field label="Start date" hint="The first invoice is generated on this date once activated.">{(p) => <Input {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="Payment terms (days)">{(p) => <Input {...p} type="number" min={0} max={180} value={terms} onChange={(e) => setTerms(Number(e.target.value))} />}</Field>
        </div>
      </Dialog>
    </>
  );
}
