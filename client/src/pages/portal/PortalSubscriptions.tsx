import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { date, frequencyLabel, money } from '@/lib/format';
import { Badge, Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface Row {
  id: string;
  number: string;
  status: string;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  billingFrequency: string;
  total: string;
  autoRenew: boolean;
  plan: { name: string };
}

export default function PortalSubscriptions() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal-subscriptions'], queryFn: () => api.get<{ data: Row[] }>('/portal/subscriptions') });
  return (
    <>
      <PageHeader title="My subscriptions" description="Current and previous subscriptions, with renewal and expiry dates." />
      <Card>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Subscription</Th><Th>Plan</Th><Th>Status</Th><Th>Started</Th><Th>Next billing</Th><Th>Expires</Th><Th className="text-right">Per period</Th></Tr></THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={7} rows={3} /> : data?.data.map((s) => (
                  <Tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/portal/subscriptions/${s.id}`)}>
                    <Td className="font-medium">{s.number}</Td>
                    <Td>{s.plan.name} <span className="text-xs text-muted">· {frequencyLabel[s.billingFrequency]}</span></Td>
                    <Td><StatusBadge status={s.status} /></Td>
                    <Td className="text-ink-soft">{date(s.startDate)}</Td>
                    <Td className="text-ink-soft">{s.status === 'ACTIVE' ? date(s.nextBillingDate) : '—'}</Td>
                    <Td className="text-ink-soft">{s.endDate ? date(s.endDate) : 'Open-ended'} {s.endDate && s.autoRenew && <Badge tone="green">Auto-renews</Badge>}</Td>
                    <Td className="text-right font-medium tabular">{money(s.total)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && !data?.data.length && <EmptyState icon={Repeat} title="No subscriptions yet" description="Browse our plans and request a quotation to get started." action={<Button onClick={() => navigate('/portal/plans')}>Browse plans</Button>} />}
          </>
        )}
      </Card>
    </>
  );
}
