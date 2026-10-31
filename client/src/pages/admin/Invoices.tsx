import { useNavigate } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { date, money } from '@/lib/format';
import { useListState, usePaged } from '@/lib/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, Input } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Pagination, SortableTh, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';

interface Row {
  id: string;
  number: string;
  status: string;
  displayStatus: string;
  source: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  customer: { id: string; name: string; companyName: string | null };
  subscription: { id: string; number: string } | null;
}

export default function Invoices() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useListState({ sort: 'invoiceDate' });
  const { data, isLoading, error, refetch } = usePaged<Row>('invoices', '/invoices', list.query);
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Draft → Confirmed → Paid. An invoice is paid only when recorded payments cover it."
        actions={can('invoices:write') && <Button variant="secondary" onClick={() => navigate('/invoices/new')}><Plus /> Manual invoice</Button>}
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search invoice, customer or subscription">
          <FilterSelect
            label="Status"
            value={list.filters.status}
            onChange={(v) => list.setFilter('status', v)}
            options={[['DRAFT', 'Draft'], ['OPEN', 'Outstanding (all open)'], ['CONFIRMED', 'Open (unpaid)'], ['PARTIALLY_PAID', 'Partially paid'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid'], ['CANCELLED', 'Cancelled']]}
          />
          <Input type="date" aria-label="From date" className="w-auto" value={list.filters.from ?? ''} onChange={(e) => list.setFilter('from', e.target.value || undefined)} />
          <span className="text-sm text-muted">to</span>
          <Input type="date" aria-label="To date" className="w-auto" value={list.filters.to ?? ''} onChange={(e) => list.setFilter('to', e.target.value || undefined)} />
        </ListToolbar>
        {data && (
          <div className="flex flex-wrap gap-6 border-b border-line px-4 py-2.5 text-xs text-muted">
            <span>{data.meta.total.toLocaleString()} invoices</span>
            <span>Total <strong className="tabular text-ink">{money(data.meta.totalAmount as string)}</strong></span>
            <span>Balance due <strong className="tabular text-ink">{money(data.meta.totalBalance as string)}</strong></span>
          </div>
        )}
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Invoice" field="number" {...list} />
                  <Th>Customer</Th>
                  <SortableTh label="Date" field="invoiceDate" {...list} />
                  <SortableTh label="Due" field="dueDate" {...list} />
                  <Th>Status</Th>
                  <SortableTh label="Total" field="total" {...list} className="text-right" />
                  <SortableTh label="Balance" field="balanceDue" {...list} className="text-right" />
                </Tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={7} /> : data?.data.map((i) => (
                  <Tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/invoices/${i.id}`)}>
                    <Td>
                      <p className="font-medium">{i.number}</p>
                      <p className="text-xs text-muted">{i.subscription ? i.subscription.number : <Badge>Manual</Badge>}</p>
                    </Td>
                    <Td>{i.customer.companyName ?? i.customer.name}</Td>
                    <Td className="text-ink-soft">{date(i.invoiceDate)}</Td>
                    <Td className={i.displayStatus === 'OVERDUE' ? 'font-medium text-rose-600' : 'text-ink-soft'}>{date(i.dueDate)}</Td>
                    <Td><StatusBadge status={i.displayStatus} kind="invoice" /></Td>
                    <Td className="text-right tabular">{money(i.total)}</Td>
                    <Td className="text-right font-medium tabular">{money(i.balanceDue)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={FileText} title="No invoices match these filters" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
