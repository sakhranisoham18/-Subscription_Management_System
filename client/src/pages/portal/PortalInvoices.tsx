import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { date, money } from '@/lib/format';
import { useListState, usePaged } from '@/lib/hooks';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Pagination, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect } from '@/components/ListToolbar';

interface Row {
  id: string;
  number: string;
  displayStatus: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  balanceDue: string;
  subscription: { number: string } | null;
}

export default function PortalInvoices() {
  const navigate = useNavigate();
  const list = useListState();
  const { data, isLoading, error, refetch } = usePaged<Row>('portal-invoices', '/portal/invoices', list.query);
  return (
    <>
      <PageHeader title="Invoices" description="View and download your invoices." />
      <Card>
        <div className="border-b border-line p-3">
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[['OPEN', 'Outstanding'], ['OVERDUE', 'Overdue'], ['PARTIALLY_PAID', 'Partially paid'], ['PAID', 'Paid']]} />
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Invoice</Th><Th>Subscription</Th><Th>Date</Th><Th>Due</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th></Tr></THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={7} /> : data?.data.map((i) => (
                  <Tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/portal/invoices/${i.id}`)}>
                    <Td className="font-medium">{i.number}</Td>
                    <Td className="text-ink-soft">{i.subscription?.number ?? '—'}</Td>
                    <Td>{date(i.invoiceDate)}</Td>
                    <Td className={i.displayStatus === 'OVERDUE' ? 'font-medium text-rose-600' : ''}>{date(i.dueDate)}</Td>
                    <Td><StatusBadge status={i.displayStatus} kind="invoice" /></Td>
                    <Td className="text-right tabular">{money(i.total)}</Td>
                    <Td className="text-right font-medium tabular">{money(i.balanceDue)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && !data?.data.length && <EmptyState icon={FileText} title="No invoices found" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
