import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Printer } from 'lucide-react';
import { api, errorMessage, openFile } from '@/lib/api';
import { date, methodLabel, money } from '@/lib/format';
import type { DocLine } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader, StatusBadge } from '@/components/ui/feedback';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { BackLink } from '@/components/layout/AppShell';
import { DocLinesTable, Totals } from '@/components/DocLines';

interface Inv {
  id: string;
  number: string;
  displayStatus: string;
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
  discount: { code: string } | null;
  subscription: { number: string } | null;
  lines: DocLine[];
  allocations: { id: string; amount: string; payment: { number: string; method: string; paymentDate: string } }[];
}

export default function PortalInvoiceDetail() {
  const { id } = useParams();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal-invoice', id], queryFn: () => api.get<{ data: Inv }>(`/portal/invoices/${id}`) });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const i = data.data;
  const pdf = (download?: boolean) => openFile(`/portal/invoices/${i.id}/pdf${download ? '?download=1' : ''}`, { download }).catch((e) => toast.error(errorMessage(e)));
  return (
    <>
      <PageHeader
        back={<BackLink to="/portal/invoices">Invoices</BackLink>}
        title={<span className="flex items-center gap-3">{i.number} <StatusBadge status={i.displayStatus} kind="invoice" /></span>}
        description={`Issued ${date(i.invoiceDate)} · due ${date(i.dueDate)}${i.subscription ? ` · ${i.subscription.number}` : ''}`}
        actions={<><Button variant="secondary" onClick={() => pdf()}><Printer /> Print</Button><Button onClick={() => pdf(true)}><Download /> Download PDF</Button></>}
      />
      {i.displayStatus === 'OVERDUE' && <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">This invoice is overdue. Please arrange payment of {money(i.balanceDue)} and quote {i.number}.</p>}
      <div className="space-y-6">
        <Card>
          <CardHeader title="Invoice lines" description={i.periodStart ? `Service period ${date(i.periodStart)} – ${date(i.periodEnd)}` : undefined} />
          <DocLinesTable lines={i.lines} />
          <Totals subtotal={i.subtotal} discountTotal={i.discountTotal} taxTotal={i.taxTotal} total={i.total} discountLabel={i.discount?.code} extra={[['Amount paid', `−${money(i.amountPaid)}`], ['Balance due', money(i.balanceDue), true]]} />
        </Card>
        <Card>
          <CardHeader title="Payments received" />
          <Table>
            <THead><Tr><Th>Payment</Th><Th>Date</Th><Th>Method</Th><Th className="text-right">Amount</Th></Tr></THead>
            <TBody>
              {i.allocations.map((a) => <Tr key={a.id}><Td className="font-medium">{a.payment.number}</Td><Td>{date(a.payment.paymentDate)}</Td><Td>{methodLabel[a.payment.method]}</Td><Td className="text-right tabular">{money(a.amount)}</Td></Tr>)}
              {!i.allocations.length && <Tr><Td colSpan={4} className="py-6 text-center text-muted">No payments received yet.</Td></Tr>}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
