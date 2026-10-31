import { useNavigate } from 'react-router-dom';
import { Plus, Repeat } from 'lucide-react';
import { date, frequencyLabel, money } from '@/lib/format';
import { useListState, usePaged } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
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
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  billingFrequency: string;
  total: string;
  closeReason: string | null;
  customer: { id: string; name: string; companyName: string | null };
  plan: { id: string; name: string };
}

export default function Subscriptions() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useListState({ sort: 'createdAt' });
  const { data, isLoading, error, refetch } = usePaged<Row>('subscriptions', '/subscriptions', list.query);
  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Draft → Quotation → Confirmed → Active → Closed. Everyone on the team can see where each one stands."
        actions={can('subscriptions:write') && <Button onClick={() => navigate('/subscriptions/new')}><Plus /> New subscription</Button>}
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search number or customer">
          <FilterSelect
            label="Status"
            value={list.filters.status}
            onChange={(v) => list.setFilter('status', v)}
            options={['DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE', 'PAUSED', 'CLOSED'].map((s) => [s, titleCase(s)])}
          />
          <FilterSelect label="Billing" value={list.filters.billingFrequency} onChange={(v) => list.setFilter('billingFrequency', v)} options={Object.entries(frequencyLabel)} />
          <FilterSelect label="View" allLabel="Everything" value={list.filters.view} onChange={(v) => list.setFilter('view', v)} options={[['dueForBilling', 'Due for billing'], ['endingSoon', 'Ending in 30 days']]} />
        </ListToolbar>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Number" field="number" {...list} />
                  <Th>Customer</Th>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <SortableTh label="Start" field="startDate" {...list} />
                  <SortableTh label="Next billing" field="nextBillingDate" {...list} />
                  <SortableTh label="Expires" field="endDate" {...list} />
                  <SortableTh label="Per period" field="total" {...list} className="text-right" />
                </Tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={8} /> : data?.data.map((s) => (
                  <Tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/subscriptions/${s.id}`)}>
                    <Td className="font-medium">{s.number}</Td>
                    <Td>{s.customer.companyName ?? s.customer.name}</Td>
                    <Td className="text-ink-soft">{s.plan.name} <span className="text-xs text-muted">· {frequencyLabel[s.billingFrequency]}</span></Td>
                    <Td>
                      <StatusBadge status={s.status} />
                      {s.closeReason && <span className="ml-1 text-xs text-muted">{titleCase(s.closeReason)}</span>}
                    </Td>
                    <Td className="text-ink-soft">{date(s.startDate)}</Td>
                    <Td className="text-ink-soft">{s.status === 'ACTIVE' || s.status === 'PAUSED' ? date(s.nextBillingDate) : '—'}</Td>
                    <Td className="text-ink-soft">{s.endDate ? date(s.endDate) : 'Open-ended'}</Td>
                    <Td className="text-right font-medium tabular">{money(s.total)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={Repeat} title="No subscriptions found" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
