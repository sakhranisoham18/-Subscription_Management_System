import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAction, useListState, usePaged } from '@/lib/hooks';
import type { CustomerRow } from '@/lib/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Pagination, SortableTh, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';
import { CustomerFormDialog, type CustomerValues } from '@/components/forms/CustomerForm';

export default function Customers() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const list = useListState({ sort: 'createdAt' });
  const { data, isLoading, error, refetch } = usePaged<CustomerRow>('customers', '/customers', list.query);
  const [creating, setCreating] = useState(false);
  const create = useAction((v: CustomerValues) => api.post<{ data: { id: string } }>('/customers', v), {
    success: 'Customer created',
    invalidate: [['customers'], ['options'], ['customer-picker']],
    onSuccess: (res) => navigate(`/customers/${res.data.id}`),
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone Brightloop bills — from small shops to large companies."
        actions={
          can('customers:write') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New customer
            </Button>
          )
        }
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search name, company, email or phone">
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']]} />
        </ListToolbar>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Customer" field="name" {...list} />
                  <SortableTh label="Email" field="email" {...list} />
                  <Th>City</Th>
                  <Th className="text-right">Active subs</Th>
                  <Th className="text-right">Outstanding</Th>
                  <Th>Status</Th>
                  <SortableTh label="Since" field="createdAt" {...list} />
                </Tr>
              </THead>
              <TBody>
                {isLoading ? (
                  <TableSkeleton cols={7} />
                ) : (
                  data?.data.map((c) => (
                    <Tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/customers/${c.id}`)}>
                      <Td>
                        <p className="font-medium">{c.companyName ?? c.name}</p>
                        {c.companyName && <p className="text-xs text-muted">{c.name}</p>}
                      </Td>
                      <Td className="text-ink-soft">
                        {c.email}
                        {c.hasPortalAccess && (
                          <Badge tone="indigo" className="ml-2">
                            Portal
                          </Badge>
                        )}
                      </Td>
                      <Td className="text-ink-soft">{c.city ?? '—'}</Td>
                      <Td className="text-right tabular">{c.activeSubscriptions}</Td>
                      <Td className={`text-right tabular ${Number(c.outstanding) > 0 ? 'font-medium' : 'text-muted'}`}>{money(c.outstanding)}</Td>
                      <Td>
                        <StatusBadge status={c.status} />
                      </Td>
                      <Td className="text-ink-soft">{date(c.createdAt)}</Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && (
              <EmptyState
                icon={Users}
                title={list.query.search ? 'No customers match your search' : 'No customers yet'}
                action={can('customers:write') && !list.query.search ? <Button onClick={() => setCreating(true)}>Add your first customer</Button> : undefined}
              />
            )}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
      <CustomerFormDialog open={creating} onOpenChange={setCreating} title="New customer" onSubmit={(v) => create.mutateAsync(v)} />
    </>
  );
}
