import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { date, methodLabel, money } from '@/lib/format';
import { useListState, usePaged } from '@/lib/hooks';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/feedback';
import { Pagination, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

interface Row {
  id: string;
  number: string;
  method: string;
  amount: string;
  paymentDate: string;
  reference: string | null;
  allocations: { amount: string; invoice: { id: string; number: string } }[];
}

export default function PortalPayments() {
  const list = useListState();
  const { data, isLoading, error, refetch } = usePaged<Row>('portal-payments', '/portal/payments', list.query);
  return (
    <>
      <PageHeader title="Payment history" description="Payments Brightloop has received from you." />
      <Card>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Payment</Th><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th>Applied to</Th><Th className="text-right">Amount</Th></Tr></THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={6} /> : data?.data.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium">{p.number}</Td>
                    <Td>{date(p.paymentDate)}</Td>
                    <Td>{methodLabel[p.method]}</Td>
                    <Td className="text-ink-soft">{p.reference ?? '—'}</Td>
                    <Td>{p.allocations.map((a) => <Link key={a.invoice.id} to={`/portal/invoices/${a.invoice.id}`} className="mr-2 text-brand-600 hover:underline">{a.invoice.number}</Link>)}</Td>
                    <Td className="text-right font-medium tabular">{money(p.amount)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && !data?.data.length && <EmptyState icon={CreditCard} title="No payments yet" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
