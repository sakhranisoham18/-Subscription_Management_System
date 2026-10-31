import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, CalendarClock, Play } from 'lucide-react';
import { api, type Paged } from '@/lib/api';
import { date, dateTime, frequencyLabel, money, todayIso } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, Field, Input } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatCard, StatusBadge } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Pagination, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

interface Preview {
  asOf: string;
  total: number;
  estimatedAmount: string;
  items: {
    id: string;
    number: string;
    nextBillingDate: string;
    endDate: string | null;
    billingFrequency: string;
    total: string;
    periodsDue: number;
    customer: { id: string; name: string; companyName: string | null };
    plan: { name: string };
  }[];
}

interface Run {
  id: string;
  trigger: string;
  asOfDate: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  subscriptionsProcessed: number;
  invoicesCreated: number;
  failures: number;
  skipped: number;
  errorSummary: string | null;
  triggeredBy: { name: string } | null;
}

interface RunDetail extends Run {
  events: { id: string; status: string; message: string | null; periodStart: string | null; subscription: { id: string; number: string; customer: { name: string; companyName: string | null } }; invoice: { id: string; number: string; total: string } | null }[];
}

export default function Billing() {
  const [asOf, setAsOf] = useState(todayIso());
  const [page, setPage] = useState(1);
  const [runsPage, setRunsPage] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [runId, setRunId] = useState<string>();
  const preview = useQuery({ queryKey: ['billing-preview', asOf, page], queryFn: () => api.get<{ data: Preview }>('/billing/preview', { asOf, page, pageSize: 25 }) });
  const runs = useQuery({ queryKey: ['billing-runs', runsPage], queryFn: () => api.get<Paged<Run> & { meta: { scheduler: { enabled: boolean; cron: string; timezone: string } } }>('/billing/runs', { page: runsPage, pageSize: 10 }) });
  const runDetail = useQuery({ queryKey: ['billing-run', runId], queryFn: () => api.get<{ data: RunDetail }>(`/billing/runs/${runId}`), enabled: Boolean(runId) });
  const run = useAction(() => api.post<{ data: Run }>('/billing/run', { asOf }), {
    success: (r) => `Billing run finished: ${r.data.invoicesCreated} invoice(s) created${r.data.skipped ? `, ${r.data.skipped} already billed` : ''}${r.data.failures ? `, ${r.data.failures} failed` : ''}`,
    invalidate: [['billing-preview'], ['billing-runs'], ['invoices'], ['subscriptions'], ['subscription'], ['dashboard']],
    onSuccess: (r) => { setConfirming(false); setRunId(r.data.id); },
  });
  const p = preview.data?.data;
  const scheduler = runs.data?.meta.scheduler;

  return (
    <>
      <PageHeader
        title="Recurring billing"
        description="Generates invoices for every active subscription that is due — safely: no period is ever billed twice or skipped."
        actions={
          <>
            <Field label="Bill as of" className="w-44">{(fp) => <Input {...fp} type="date" max={todayIso()} value={asOf} onChange={(e) => { setAsOf(e.target.value); setPage(1); }} />}</Field>
            <Button className="mt-6" size="lg" disabled={!p?.total} onClick={() => setConfirming(true)}><Play /> Run billing now</Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Subscriptions due" value={p?.total ?? '—'} hint={`as of ${date(asOf)}`} icon={CalendarClock} />
        <StatCard label="Estimated (one period each)" value={p ? money(p.estimatedAmount) : '—'} hint="Before automatic discounts" icon={CalendarCheck2} tone="green" />
        <StatCard
          label="Scheduler"
          value={scheduler ? (scheduler.enabled ? 'On' : 'Off') : '—'}
          hint={scheduler ? `cron “${scheduler.cron}” · ${scheduler.timezone}` : undefined}
          icon={CalendarClock}
          tone={scheduler?.enabled ? 'indigo' : 'amber'}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Preview: due for billing" description="Each listed period becomes one invoice. Overdue periods are billed in order (catch-up)." />
        {preview.error ? <ErrorState error={preview.error} onRetry={preview.refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Subscription</Th><Th>Customer</Th><Th>Plan</Th><Th>Next billing</Th><Th className="text-right">Periods due</Th><Th className="text-right">Per period</Th></Tr></THead>
              <TBody>
                {preview.isLoading ? <TableSkeleton cols={6} rows={4} /> : p?.items.map((s) => (
                  <Tr key={s.id}>
                    <Td><Link className="font-medium hover:underline" to={`/subscriptions/${s.id}`}>{s.number}</Link></Td>
                    <Td>{s.customer.companyName ?? s.customer.name}</Td>
                    <Td className="text-ink-soft">{s.plan.name} · {frequencyLabel[s.billingFrequency]}</Td>
                    <Td className="text-ink-soft">{date(s.nextBillingDate)}</Td>
                    <Td className="text-right tabular">{s.periodsDue > 1 ? <Badge tone="amber">{s.periodsDue}</Badge> : s.periodsDue}</Td>
                    <Td className="text-right tabular">{money(s.total)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!preview.isLoading && !p?.items.length && <EmptyState icon={CalendarCheck2} title="Nothing is due" description="All active subscriptions are billed up to date. Tip: change a subscription’s next billing date to demo a run." />}
            {p && p.total > 25 && <Pagination page={page} pageSize={25} total={p.total} totalPages={Math.ceil(p.total / 25)} onPage={setPage} />}
          </>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Run history" description="Every scheduled and manual run, with counts and failures." />
        {runs.error ? <ErrorState error={runs.error} /> : (
          <>
            <Table>
              <THead><Tr><Th>Started</Th><Th>Trigger</Th><Th>As of</Th><Th>Status</Th><Th className="text-right">Processed</Th><Th className="text-right">Invoices</Th><Th className="text-right">Skipped</Th><Th className="text-right">Failed</Th></Tr></THead>
              <TBody>
                {runs.isLoading ? <TableSkeleton cols={8} rows={3} /> : runs.data?.data.map((r) => (
                  <Tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setRunId(r.id)}>
                    <Td>{dateTime(r.startedAt)}</Td>
                    <Td>{titleCase(r.trigger)}{r.triggeredBy && <span className="text-xs text-muted"> · {r.triggeredBy.name}</span>}</Td>
                    <Td>{date(r.asOfDate)}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-right tabular">{r.subscriptionsProcessed}</Td>
                    <Td className="text-right tabular font-medium">{r.invoicesCreated}</Td>
                    <Td className="text-right tabular">{r.skipped}</Td>
                    <Td className={`text-right tabular ${r.failures ? 'font-medium text-rose-600' : ''}`}>{r.failures}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!runs.isLoading && !runs.data?.data.length && <EmptyState title="No billing runs yet" />}
            {runs.data && <Pagination {...runs.data.meta} onPage={setRunsPage} />}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Run recurring billing now?"
        description={<>This generates invoices for <strong>{p?.total}</strong> due subscription(s) as of {date(asOf)} and advances their next billing dates. Running it again is safe — nothing is billed twice.</>}
        confirmLabel="Run billing"
        loading={run.isPending}
        onConfirm={() => run.mutate()}
      />
      <Dialog open={Boolean(runId)} onOpenChange={(o) => !o && setRunId(undefined)} title="Billing run detail" size="xl">
        {runDetail.data && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <StatusBadge status={runDetail.data.data.status} />
              <span className="text-muted">{dateTime(runDetail.data.data.startedAt)} → {runDetail.data.data.finishedAt ? dateTime(runDetail.data.data.finishedAt) : 'running'}</span>
            </div>
            {runDetail.data.data.errorSummary && <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{runDetail.data.data.errorSummary}</pre>}
            <Table>
              <THead><Tr><Th>Subscription</Th><Th>Customer</Th><Th>Period</Th><Th>Result</Th><Th>Invoice</Th></Tr></THead>
              <TBody>
                {runDetail.data.data.events.map((e) => (
                  <Tr key={e.id}>
                    <Td><Link className="hover:underline" to={`/subscriptions/${e.subscription.id}`}>{e.subscription.number}</Link></Td>
                    <Td>{e.subscription.customer.companyName ?? e.subscription.customer.name}</Td>
                    <Td>{date(e.periodStart)}</Td>
                    <Td><StatusBadge status={e.status} />{e.status !== 'INVOICED' && e.message && <p className="mt-1 text-xs text-muted">{e.message}</p>}</Td>
                    <Td>{e.invoice ? <Link className="font-medium hover:underline" to={`/invoices/${e.invoice.id}`}>{e.invoice.number} · {money(e.invoice.total)}</Link> : '—'}</Td>
                  </Tr>
                ))}
                {!runDetail.data.data.events.length && <Tr><Td colSpan={5} className="py-6 text-center text-muted">No subscriptions were due in this run.</Td></Tr>}
              </TBody>
            </Table>
          </div>
        )}
      </Dialog>
    </>
  );
}
