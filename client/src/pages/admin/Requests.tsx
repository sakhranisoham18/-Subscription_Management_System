import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAction, useListState, usePaged } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Field, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Pagination, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect } from '@/components/ListToolbar';

interface Row {
  id: string;
  type: string;
  status: string;
  message: string | null;
  response: string | null;
  createdAt: string;
  reviewedAt: string | null;
  subscription: { id: string; number: string; status: string; plan: { name: string } };
  customer: { id: string; name: string; companyName: string | null };
  reviewedBy: { name: string } | null;
}

export default function Requests() {
  const list = useListState();
  const status = list.filters.status ?? 'PENDING';
  const query = { ...list.query, status: status === 'ALL' ? undefined : status };
  const { data, isLoading, error, refetch } = usePaged<Row>('requests', '/requests', query);
  const [reviewing, setReviewing] = useState<{ row: Row; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [response, setResponse] = useState('');
  const review = useAction(() => api.post(`/requests/${reviewing!.row.id}/review`, { decision: reviewing!.decision, response: response || null }), {
    success: (_r) => (reviewing?.decision === 'APPROVED' ? 'Request approved and applied' : 'Request rejected'),
    invalidate: [['requests'], ['requests-pending'], ['subscription'], ['subscriptions'], ['dashboard']],
    onSuccess: () => { setReviewing(null); setResponse(''); },
  });

  return (
    <>
      <PageHeader title="Customer requests" description="Pause, resume, renewal and cancellation requests submitted from the customer portal." />
      <Card>
        <div className="flex gap-2 border-b border-line p-3">
          <FilterSelect label="Status" allLabel="All" value={status === 'ALL' ? undefined : status} onChange={(v) => list.setFilter('status', v ?? 'ALL')} options={[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']]} />
        </div>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Requested</Th><Th>Customer</Th><Th>Subscription</Th><Th>Request</Th><Th>Status</Th><Th className="w-52" /></Tr></THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={6} /> : data?.data.map((r) => (
                  <Tr key={r.id}>
                    <Td className="text-ink-soft">{dateTime(r.createdAt)}</Td>
                    <Td><Link className="hover:underline" to={`/customers/${r.customer.id}`}>{r.customer.companyName ?? r.customer.name}</Link></Td>
                    <Td><Link className="font-medium hover:underline" to={`/subscriptions/${r.subscription.id}`}>{r.subscription.number}</Link><p className="text-xs text-muted">{r.subscription.plan.name} · {titleCase(r.subscription.status)}</p></Td>
                    <Td>
                      <Badge tone={r.type === 'CANCEL' ? 'red' : r.type === 'PAUSE' ? 'amber' : 'indigo'}>{titleCase(r.type)}</Badge>
                      {r.message && <p className="mt-1 max-w-xs text-xs text-ink-soft">“{r.message}”</p>}
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                      {r.reviewedBy && <p className="mt-1 text-xs text-muted">by {r.reviewedBy.name}</p>}
                    </Td>
                    <Td className="text-right">
                      {r.status === 'PENDING' && (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" size="sm" onClick={() => setReviewing({ row: r, decision: 'REJECTED' })}>Reject</Button>
                          <Button size="sm" onClick={() => setReviewing({ row: r, decision: 'APPROVED' })}>Approve</Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={Inbox} title="No requests here" description="New customer requests will appear in this list." />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
      <Dialog
        open={Boolean(reviewing)}
        onOpenChange={(o) => !o && setReviewing(null)}
        title={reviewing?.decision === 'APPROVED' ? `Approve ${reviewing?.row.type.toLowerCase()} request?` : 'Reject request?'}
        description={reviewing?.decision === 'APPROVED' ? 'The change is applied to the subscription immediately, following the plan’s rules. The customer is notified by email.' : 'The customer is notified by email.'}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setReviewing(null)}>Cancel</Button><Button variant={reviewing?.decision === 'APPROVED' ? 'primary' : 'danger'} loading={review.isPending} onClick={() => review.mutate()}>{reviewing?.decision === 'APPROVED' ? 'Approve' : 'Reject'}</Button></>}
      >
        <Field label="Message to the customer (optional)">{(p) => <Textarea {...p} rows={3} value={response} onChange={(e) => setResponse(e.target.value)} />}</Field>
      </Dialog>
    </>
  );
}
