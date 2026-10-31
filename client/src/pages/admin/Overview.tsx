import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CircleDollarSign, Clock4, FileWarning, Inbox, Repeat, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { date, money, methodLabel } from '@/lib/format';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader, StatCard, StatusBadge } from '@/components/ui/feedback';
import { RevenueChart, StatusDonut } from '@/components/charts';

interface Summary {
  today: string;
  totalCustomers: number;
  activeSubscriptions: number;
  subscriptionsByStatus: Record<string, number>;
  endingSoon: number;
  mrr: string;
  arr: string;
  collectedThisMonth: string;
  invoicedThisMonth: string;
  outstanding: string;
  outstandingCount: number;
  overdue: string;
  overdueCount: number;
  recentInvoices: { id: string; number: string; displayStatus: string; invoiceDate: string; total: string; balanceDue: string; billToName: string }[];
  recentPayments: { id: string; number: string; method: string; amount: string; paymentDate: string; customer: { name: string; companyName: string | null } }[];
  revenueTrend: { month: string; invoiced: string; collected: string }[];
  upcomingBilling: { id: string; number: string; nextBillingDate: string; total: string; customer: { name: string; companyName: string | null }; plan: { name: string } }[];
  pendingRequests: number;
  lastBillingRun: { startedAt: string; status: string; invoicesCreated: number } | null;
  dueForBilling: number;
}

export default function Overview() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<{ data: Summary }>('/dashboard/summary') });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const s = data.data;

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user?.name.split(' ')[0]}`}
        description={`Here’s how Brightloop is doing today · ${date(s.today)}`}
        actions={
          <>
            {can('quotations:write') && (
              <Button variant="secondary" onClick={() => navigate('/quotations/new')}>
                New quotation
              </Button>
            )}
            {can('billing:run') && <Button onClick={() => navigate('/billing')}>Run billing</Button>}
          </>
        }
      />

      {(s.dueForBilling > 0 || s.pendingRequests > 0) && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          {s.dueForBilling > 0 && (
            <Link to="/billing" className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 hover:bg-brand-100">
              <CalendarClock className="size-5" />
              <span>
                <strong>{s.dueForBilling}</strong> subscription{s.dueForBilling === 1 ? ' is' : 's are'} due for billing. Preview and run billing →
              </span>
            </Link>
          )}
          {s.pendingRequests > 0 && (
            <Link to="/requests" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
              <Inbox className="size-5" />
              <span>
                <strong>{s.pendingRequests}</strong> customer request{s.pendingRequests === 1 ? '' : 's'} waiting for review →
              </span>
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Monthly recurring revenue" value={money(s.mrr)} hint={`ARR ${money(s.arr)} · active subscriptions, before tax`} icon={Repeat} />
        <StatCard label="Collected this month" value={money(s.collectedThisMonth)} hint={`Invoiced ${money(s.invoicedThisMonth)}`} icon={Wallet} tone="green" />
        <StatCard label="Outstanding" value={money(s.outstanding)} hint={`${s.outstandingCount} open invoices`} icon={CircleDollarSign} tone="blue" onClick={() => navigate('/invoices?status=OPEN')} />
        <StatCard label="Overdue" value={money(s.overdue)} hint={`${s.overdueCount} invoices past due`} icon={FileWarning} tone="red" onClick={() => navigate('/invoices?status=OVERDUE')} />
        <StatCard label="Customers" value={s.totalCustomers.toLocaleString()} icon={Users} tone="violet" onClick={() => navigate('/customers')} />
        <StatCard label="Active subscriptions" value={s.activeSubscriptions.toLocaleString()} icon={Repeat} tone="green" onClick={() => navigate('/subscriptions?status=ACTIVE')} />
        <StatCard label="Ending in 30 days" value={s.endingSoon} hint="Renew or let close" icon={Clock4} tone="amber" onClick={() => navigate('/subscriptions?view=endingSoon')} />
        <StatCard
          label="Last billing run"
          value={s.lastBillingRun ? `${s.lastBillingRun.invoicesCreated} invoices` : 'Not run yet'}
          hint={s.lastBillingRun ? `${date(s.lastBillingRun.startedAt)} · ${s.lastBillingRun.status.toLowerCase()}` : 'Scheduled daily'}
          icon={s.lastBillingRun?.status === 'FAILED' ? AlertTriangle : CalendarClock}
          tone={s.lastBillingRun?.status === 'FAILED' ? 'red' : 'indigo'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue trend" description="Invoiced (confirmed invoices) vs collected (payments), last 6 months" />
          <CardBody>
            <RevenueChart data={s.revenueTrend} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Subscriptions by status" />
          <CardBody>
            <StatusDonut counts={s.subscriptionsByStatus} height={150} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming billing" description="Next 14 days" actions={<Link to="/subscriptions?view=dueForBilling" className="text-xs text-brand-600 hover:underline">Due now</Link>} />
          <ul className="divide-y divide-line">
            {s.upcomingBilling.length === 0 && <li className="px-5 py-6 text-sm text-muted">Nothing scheduled in the next two weeks.</li>}
            {s.upcomingBilling.map((u) => (
              <li key={u.id}>
                <Link to={`/subscriptions/${u.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.customer.companyName ?? u.customer.name}</p>
                    <p className="text-xs text-muted">
                      {u.number} · {u.plan.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular">{money(u.total)}</p>
                    <p className="text-xs text-muted">{date(u.nextBillingDate)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Recent invoices" actions={<Link to="/invoices" className="text-xs text-brand-600 hover:underline">View all</Link>} />
          <ul className="divide-y divide-line">
            {s.recentInvoices.map((i) => (
              <li key={i.id}>
                <Link to={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.billToName}</p>
                    <p className="text-xs text-muted">
                      {i.number} · {date(i.invoiceDate)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm tabular">{money(i.total)}</span>
                    <StatusBadge status={i.displayStatus} kind="invoice" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Recent payments" actions={<Link to="/payments" className="text-xs text-brand-600 hover:underline">View all</Link>} />
          <ul className="divide-y divide-line">
            {s.recentPayments.length === 0 && <li className="px-5 py-6 text-sm text-muted">No payments recorded yet.</li>}
            {s.recentPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.customer.companyName ?? p.customer.name}</p>
                  <p className="text-xs text-muted">
                    {p.number} · {methodLabel[p.method]} · {date(p.paymentDate)}
                  </p>
                </div>
                <span className="text-sm font-medium tabular text-emerald-700">+{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
