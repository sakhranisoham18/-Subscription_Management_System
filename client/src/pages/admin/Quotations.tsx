import { useNavigate } from 'react-router-dom';
import { FileSignature, Plus } from 'lucide-react';
import { date, money } from '@/lib/format';
import { useListState, usePaged } from '@/lib/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Pagination, SortableTh, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';

interface Row {
  id: string;
  number: string;
  status: string;
  quotationDate: string;
  validUntil: string;
  total: string;
  customer: { id: string; name: string; companyName: string | null };
  subscription: { id: string; number: string } | null;
}

export default function Quotations() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useListState({ sort: 'createdAt' });
  const { data, isLoading, error, refetch } = usePaged<Row>('quotations', '/quotations', list.query);
  return (
    <>
      <PageHeader
        title="Quotations"
        description="Offers sent to customers. Accepted quotations convert into subscriptions."
        actions={can('quotations:write') && <Button onClick={() => navigate('/quotations/new')}><Plus /> New quotation</Button>}
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search number or customer">
          <FilterSelect
            label="Status"
            value={list.filters.status}
            onChange={(v) => list.setFilter('status', v)}
            options={[['DRAFT', 'Draft'], ['SENT', 'Sent'], ['ACCEPTED', 'Accepted'], ['REJECTED', 'Rejected'], ['EXPIRED', 'Expired'], ['CONVERTED', 'Converted']]}
          />
        </ListToolbar>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Number" field="number" {...list} />
                  <Th>Customer</Th>
                  <SortableTh label="Date" field="quotationDate" {...list} />
                  <SortableTh label="Valid until" field="validUntil" {...list} />
                  <Th>Status</Th>
                  <Th>Subscription</Th>
                  <SortableTh label="Total" field="total" {...list} className="text-right" />
                </Tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={7} /> : data?.data.map((q) => (
                  <Tr key={q.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/quotations/${q.id}`)}>
                    <Td className="font-medium">{q.number}</Td>
                    <Td>{q.customer.companyName ?? q.customer.name}</Td>
                    <Td className="text-ink-soft">{date(q.quotationDate)}</Td>
                    <Td className="text-ink-soft">{date(q.validUntil)}</Td>
                    <Td><StatusBadge status={q.status} /></Td>
                    <Td className="text-ink-soft">{q.subscription?.number ?? '—'}</Td>
                    <Td className="text-right font-medium tabular">{money(q.total)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={FileSignature} title="No quotations found" action={can('quotations:write') ? <Button onClick={() => navigate('/quotations/new')}>Create a quotation</Button> : undefined} />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
