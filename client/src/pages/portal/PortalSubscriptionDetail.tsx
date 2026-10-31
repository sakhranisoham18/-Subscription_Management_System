import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, dateTime, intervalLabel, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { DocLine } from '@/lib/types';
import { titleCase } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Field, Textarea } from '@/components/ui/primitives';
import { DescriptionList, ErrorState, PageHeader, PageLoader, StatusBadge } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { BackLink } from '@/components/layout/AppShell';
import { DocLinesTable, Totals } from '@/components/DocLines';

interface Sub {
  id: string;
  number: string;
  status: string;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  billingFrequency: string;
  billingInterval: number;
  paymentTermsDays: number;
  autoRenew: boolean;
  closeReason: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  plan: { name: string; description: string | null; allowPause: boolean; allowEarlyClose: boolean; allowRenew: boolean };
  lines: DocLine[];
  invoices: { id: string; number: string; displayStatus: string; invoiceDate: string; dueDate: string; total: string; balanceDue: string }[];
  changeRequests: { id: string; type: string; status: string; message: string | null; response: string | null; createdAt: string }[];
  upcomingBillingDates: string[];
}

type ReqType = 'PAUSE' | 'RESUME' | 'RENEW' | 'CANCEL';
const COPY: Record<ReqType, { title: string; description: string; button: string }> = {
  PAUSE: { title: 'Request to pause', description: 'Our team will review your request. Billing stops while the subscription is paused.', button: 'Request pause' },
  RESUME: { title: 'Request to resume', description: 'Ask our team to restart your paused subscription.', button: 'Request resume' },
  RENEW: { title: 'Request renewal', description: 'Ask our team to extend your subscription for another term.', button: 'Request renewal' },
  CANCEL: { title: 'Request cancellation', description: 'Our team will review the request and confirm by email. Issued invoices remain payable.', button: 'Request cancellation' },
};

export default function PortalSubscriptionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal-subscription', id], queryFn: () => api.get<{ data: Sub }>(`/portal/subscriptions/${id}`) });
  const [type, setType] = useState<ReqType | null>(null);
  const [message, setMessage] = useState('');
  const request = useAction(() => api.post(`/portal/subscriptions/${id}/requests`, { type, message: message || null }), {
    success: 'Request sent — our team will review it shortly',
    invalidate: [['portal-subscription', id]],
    onSuccess: () => { setType(null); setMessage(''); },
  });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const s = data.data;
  const pending = s.changeRequests.find((r) => r.status === 'PENDING');
  const options: ReqType[] = [
    ...(s.status === 'ACTIVE' && s.plan.allowPause ? (['PAUSE'] as const) : []),
    ...(s.status === 'PAUSED' ? (['RESUME'] as const) : []),
    ...(s.plan.allowRenew && s.endDate && ['ACTIVE', 'PAUSED', 'CLOSED'].includes(s.status) ? (['RENEW'] as const) : []),
    ...(['ACTIVE', 'PAUSED', 'CONFIRMED', 'QUOTATION'].includes(s.status) && (s.plan.allowEarlyClose || s.status === 'CONFIRMED') ? (['CANCEL'] as const) : []),
  ];

  return (
    <>
      <PageHeader
        back={<BackLink to="/portal/subscriptions">My subscriptions</BackLink>}
        title={<span className="flex items-center gap-3">{s.number} <StatusBadge status={s.status} />{s.closeReason && <Badge>{titleCase(s.closeReason)}</Badge>}</span>}
        description={`${s.plan.name} · ${intervalLabel(s.billingFrequency, s.billingInterval)}`}
        actions={options.map((o) => (
          <Button key={o} variant={o === 'CANCEL' ? 'danger-ghost' : 'secondary'} disabled={Boolean(pending)} title={pending ? 'You already have a pending request' : undefined} onClick={() => setType(o)}>{COPY[o].button}</Button>
        ))}
      />
      {pending && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">Your <strong>{pending.type.toLowerCase()}</strong> request from {dateTime(pending.createdAt)} is awaiting review.</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="What you’re subscribed to" />
            <DocLinesTable lines={s.lines} />
            <Totals subtotal={s.subtotal} discountTotal={s.discountTotal} taxTotal={s.taxTotal} total={s.total} />
          </Card>
          <Card>
            <CardHeader title="Invoices" />
            <Table>
              <THead><Tr><Th>Invoice</Th><Th>Due</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th></Tr></THead>
              <TBody>
                {s.invoices.map((i) => (
                  <Tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/portal/invoices/${i.id}`)}>
                    <Td className="font-medium">{i.number}</Td>
                    <Td>{date(i.dueDate)}</Td>
                    <Td><StatusBadge status={i.displayStatus} kind="invoice" /></Td>
                    <Td className="text-right tabular">{money(i.total)}</Td>
                    <Td className="text-right tabular">{money(i.balanceDue)}</Td>
                  </Tr>
                ))}
                {!s.invoices.length && <Tr><Td colSpan={5} className="py-6 text-center text-muted">No invoices yet.</Td></Tr>}
              </TBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Renewal & expiry" />
            <CardBody>
              <DescriptionList
                cols={1}
                items={[
                  ['Started', date(s.startDate)],
                  ['Expires', s.endDate ? date(s.endDate) : 'Open-ended'],
                  ['At expiry', s.autoRenew ? 'Renews automatically' : 'Closes at the end of the term'],
                  ['Next billing', s.status === 'ACTIVE' ? date(s.nextBillingDate) : '—'],
                  ['Payment terms', `${s.paymentTermsDays} days`],
                ]}
              />
            </CardBody>
          </Card>
          {s.upcomingBillingDates.length > 0 && (
            <Card>
              <CardHeader title="Upcoming billing" />
              <CardBody>
                <ul className="space-y-2 text-sm">
                  {s.upcomingBillingDates.map((d) => <li key={d} className="flex justify-between"><span>{date(d)}</span><span className="tabular text-ink-soft">{money(s.total)}</span></li>)}
                </ul>
              </CardBody>
            </Card>
          )}
          {s.changeRequests.length > 0 && (
            <Card>
              <CardHeader title="Your requests" />
              <ul className="divide-y divide-line">
                {s.changeRequests.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between"><span className="font-medium">{titleCase(r.type)}</span><StatusBadge status={r.status} /></div>
                    <p className="text-xs text-muted">{dateTime(r.createdAt)}</p>
                    {r.response && <p className="mt-1 text-xs text-ink-soft">Team: {r.response}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <Dialog
        open={Boolean(type)}
        onOpenChange={(o) => !o && setType(null)}
        title={type ? COPY[type].title : ''}
        description={type ? COPY[type].description : undefined}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setType(null)}>Cancel</Button><Button variant={type === 'CANCEL' ? 'danger' : 'primary'} loading={request.isPending} onClick={() => request.mutate()}>Send request</Button></>}
      >
        <Field label="Message (optional)">{(p) => <Textarea {...p} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
      </Dialog>
    </>
  );
}
