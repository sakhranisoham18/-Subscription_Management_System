import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, CreditCard, Download, FileText, Printer, Send } from 'lucide-react';
import { api, errorMessage, openFile } from '@/lib/api';
import { date, dateTime, methodLabel, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { DocLine, HistoryEntry } from '@/lib/types';
import { titleCase } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { DescriptionList, ErrorState, PageHeader, PageLoader, StatusBadge, Timeline } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { BackLink } from '@/components/layout/AppShell';
import { DocLinesTable, Totals } from '@/components/DocLines';
import { PaymentDialog } from '@/components/forms/PaymentDialog';

interface Inv {
  id: string;
  number: string;
  status: string;
  displayStatus: string;
  source: string;
  invoiceDate: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  billToName: string;
  billToEmail: string;
  billToAddress: string | null;
  billToTaxId: string | null;
  notes: string | null;
  sentAt: string | null;
  confirmedAt: string | null;
  cancellationReason: string | null;
  customer: { id: string };
  subscription: { id: string; number: string; plan: { name: string } } | null;
  discount: { code: string; name: string } | null;
  lines: DocLine[];
  allocations: { id: string; amount: string; payment: { id: string; number: string; method: string; paymentDate: string; status: string; reference: string | null } }[];
  history: HistoryEntry[];
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const canWrite = can('invoices:write');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<{ data: Inv }>(`/invoices/${id}`) });
  const inv = [['invoice', id], ['invoices'], ['dashboard']];
  const confirm = useAction((sendEmail: boolean) => api.post<{ emailWarning?: string }>(`/invoices/${id}/confirm`, { sendEmail }), {
    success: (r) => (r.emailWarning ? 'Invoice confirmed' : 'Invoice confirmed and emailed to the customer'),
    invalidate: inv,
    onSuccess: (r) => { if (r.emailWarning) toast.warning(r.emailWarning, { duration: 10000 }); },
  });
  const send = useAction(() => api.post<{ data: { message: string } }>(`/invoices/${id}/send`), { success: (r) => r.data.message, invalidate: inv });
  const cancel = useAction((reason: string) => api.post(`/invoices/${id}/cancel`, { reason }), { success: 'Invoice cancelled', invalidate: inv });
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const i = data.data;
  const open = i.status === 'CONFIRMED' || i.status === 'PARTIALLY_PAID';
  const pdf = (download?: boolean) => openFile(`/invoices/${i.id}/pdf${download ? '?download=1' : ''}`, { download }).catch((e) => toast.error(errorMessage(e)));

  return (
    <>
      <PageHeader
        back={<BackLink to="/invoices">Invoices</BackLink>}
        title={<span className="flex items-center gap-3">{i.number} <StatusBadge status={i.displayStatus} kind="invoice" /></span>}
        description={<><Link to={`/customers/${i.customer.id}`} className="text-brand-600 hover:underline">{i.billToName}</Link> · issued {date(i.invoiceDate)} · due {date(i.dueDate)}</>}
        actions={
          <>
            <Button variant="secondary" onClick={() => pdf()}><Printer /> Print / PDF</Button>
            <Button variant="secondary" size="icon" aria-label="Download PDF" onClick={() => pdf(true)}><Download /></Button>
            {canWrite && ['DRAFT', 'CONFIRMED'].includes(i.status) && Number(i.amountPaid) === 0 && <Button variant="danger-ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>}
            {canWrite && i.status !== 'DRAFT' && i.status !== 'CANCELLED' && <Button variant="secondary" loading={send.isPending} onClick={() => send.mutate()}><Send /> Email</Button>}
            {canWrite && i.status === 'DRAFT' && <Button onClick={() => setConfirming(true)}><CheckCircle2 /> Confirm</Button>}
            {can('payments:write') && open && <Button onClick={() => setPaying(true)}><CreditCard /> Record payment</Button>}
          </>
        }
      />
      {i.status === 'CANCELLED' && <p className="mb-4 rounded-lg bg-slate-100 px-4 py-3 text-sm">Cancelled: {i.cancellationReason}</p>}
      {i.displayStatus === 'OVERDUE' && <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">This invoice is overdue — {money(i.balanceDue)} was due on {date(i.dueDate)}.</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Lines" description={i.periodStart ? `Service period ${date(i.periodStart)} – ${date(i.periodEnd)}` : 'One-off invoice'} />
            <DocLinesTable lines={i.lines} />
            <Totals
              subtotal={i.subtotal}
              discountTotal={i.discountTotal}
              taxTotal={i.taxTotal}
              total={i.total}
              discountLabel={i.discount?.code}
              extra={[
                ['Amount paid', `−${money(i.amountPaid)}`],
                ['Balance due', money(i.balanceDue), true],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Payments" description="Payment allocations against this invoice" />
            <Table>
              <THead><Tr><Th>Payment</Th><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th>Status</Th><Th className="text-right">Amount</Th></Tr></THead>
              <TBody>
                {i.allocations.map((a) => (
                  <Tr key={a.id} className={a.payment.status === 'VOIDED' ? 'opacity-60' : ''}>
                    <Td className="font-medium"><Link to={`/payments?search=${a.payment.number}`} className="hover:underline">{a.payment.number}</Link></Td>
                    <Td>{date(a.payment.paymentDate)}</Td>
                    <Td>{methodLabel[a.payment.method]}</Td>
                    <Td className="text-ink-soft">{a.payment.reference ?? '—'}</Td>
                    <Td><StatusBadge status={a.payment.status} /></Td>
                    <Td className="text-right tabular">{money(a.amount)}</Td>
                  </Tr>
                ))}
                {!i.allocations.length && <Tr><Td colSpan={6} className="py-6 text-center text-muted">No payments recorded.</Td></Tr>}
              </TBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Bill to" />
            <CardBody>
              <DescriptionList
                cols={1}
                items={[
                  ['Customer', i.billToName],
                  ['Email', i.billToEmail],
                  ['Address', i.billToAddress ?? '—'],
                  ['Tax ID', i.billToTaxId ?? '—'],
                  ['Subscription', i.subscription ? <Link className="text-brand-600 hover:underline" to={`/subscriptions/${i.subscription.id}`}>{i.subscription.number} · {i.subscription.plan.name}</Link> : 'Manual invoice'],
                  ['Discount rule', i.discount ? `${i.discount.code} — ${i.discount.name}` : '—'],
                  ['Emailed', i.sentAt ? dateTime(i.sentAt) : 'Not yet'],
                  ['Notes', i.notes ?? '—'],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Audit trail" />
            <CardBody>
              <Timeline items={i.history.map((h) => ({ id: h.id, title: titleCase(h.action.replace('INVOICE_', '')), meta: `${h.actor?.name ?? 'System'} · ${dateTime(h.createdAt)}` }))} />
              {i.history.length === 0 && <p className="mt-2 text-xs text-muted"><FileText className="mr-1 inline size-3" />Generated by recurring billing.</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Confirm invoice?"
        description={<>Confirmed invoices are final and can receive payments. Total <strong>{money(i.total)}</strong>, due {date(i.dueDate)}.</>}
        confirmLabel="Confirm & email customer"
        loading={confirm.isPending}
        onConfirm={async () => { await confirm.mutateAsync(true); setConfirming(false); }}
      />
      <ConfirmDialog open={cancelling} onOpenChange={setCancelling} title="Cancel invoice?" description="Cancelled invoices are kept for audit but no longer count as revenue or outstanding." reasonLabel="Reason" reasonRequired tone="danger" confirmLabel="Cancel invoice" loading={cancel.isPending} onConfirm={async (r) => { await cancel.mutateAsync(r); setCancelling(false); }} />
      <PaymentDialog open={paying} onOpenChange={setPaying} customerId={i.customer.id} invoiceId={i.id} />
    </>
  );
}
