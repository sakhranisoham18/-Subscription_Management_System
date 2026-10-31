import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CircleDollarSign, FileSignature, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { date, methodLabel, money } from '@/lib/format';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader, StatCard, StatusBadge } from '@/components/ui/feedback';

interface Dash {
  activeSubscriptions: number;
  nextBilling: { id: string; number: string; nextBillingDate: string; total: string; plan: { name: string } } | null;
  outstanding: string;
  overdue: string;
  overdueCount: number;
  pendingQuotations: number;
  recentInvoices: { id: string; number: string; displayStatus: string; invoiceDate: string; dueDate: string; total: string; balanceDue: string }[];
  recentPayments: { id: string; number: string; method: string; amount: string; paymentDate: string }[];
  renewals: { id: string; number: string; status: string; endDate: string; autoRenew: boolean; plan: { name: string } }[];
}

export default function PortalDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal-dashboard'], queryFn: () => api.get<{ data: Dash }>('/portal/dashboard') });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const d = data.data;
  return (
    <>
      <PageHeader title={`Welcome, ${user?.name.split(' ')[0]}`} description="Your subscriptions, invoices and payments with Brightloop Software." />
      {Number(d.overdue) > 0 && (
        <Link to="/portal/invoices?status=OVERDUE" className="mb-6 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 hover:bg-rose-100">
          <AlertTriangle className="size-5" />
          <span>You have <strong>{d.overdueCount}</strong> overdue invoice{d.overdueCount === 1 ? '' : 's'} totalling <strong>{money(d.overdue)}</strong>. View invoices →</span>
        </Link>
      )}
      {d.pendingQuotations > 0 && (
        <Link to="/portal/quotations" className="mb-6 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800 hover:bg-brand-100">
          <FileSignature className="size-5" />
          <span><strong>{d.pendingQuotations}</strong> quotation{d.pendingQuotations === 1 ? ' is' : 's are'} waiting for your response →</span>
        </Link>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active subscriptions" value={d.activeSubscriptions} icon={Repeat} onClick={() => navigate('/portal/subscriptions')} />
        <StatCard label="Next billing" value={d.nextBilling ? date(d.nextBilling.nextBillingDate) : '—'} hint={d.nextBilling ? `${money(d.nextBilling.total)} · ${d.nextBilling.plan.name}` : 'Nothing scheduled'} icon={CalendarClock} tone="violet" />
        <StatCard label="Outstanding" value={money(d.outstanding)} icon={CircleDollarSign} tone="blue" onClick={() => navigate('/portal/invoices?status=OPEN')} />
        <StatCard label="Overdue" value={money(d.overdue)} icon={AlertTriangle} tone={Number(d.overdue) > 0 ? 'red' : 'green'} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent invoices" actions={<Link to="/portal/invoices" className="text-xs text-brand-600 hover:underline">View all</Link>} />
          <ul className="divide-y divide-line">
            {d.recentInvoices.length === 0 && <li className="px-5 py-8 text-sm text-muted">No invoices yet.</li>}
            {d.recentInvoices.map((i) => (
              <li key={i.id}>
                <Link to={`/portal/invoices/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div><p className="text-sm font-medium">{i.number}</p><p className="text-xs text-muted">Issued {date(i.invoiceDate)} · due {date(i.dueDate)}</p></div>
                  <div className="flex items-center gap-3"><span className="text-sm tabular">{money(i.total)}</span><StatusBadge status={i.displayStatus} kind="invoice" /></div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Renewals & expiry" />
            <ul className="divide-y divide-line">
              {d.renewals.length === 0 && <li className="px-5 py-6 text-sm text-muted">No subscriptions with an end date.</li>}
              {d.renewals.map((r) => (
                <li key={r.id}>
                  <Link to={`/portal/subscriptions/${r.id}`} className="block px-5 py-3 hover:bg-slate-50">
                    <p className="text-sm font-medium">{r.plan.name}</p>
                    <p className="text-xs text-muted">{r.number} · ends {date(r.endDate)} · {r.autoRenew ? 'renews automatically' : 'closes at end'}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Recent payments" actions={<Link to="/portal/payments" className="text-xs text-brand-600 hover:underline">History</Link>} />
            <ul className="divide-y divide-line">
              {d.recentPayments.length === 0 && <li className="px-5 py-6 text-sm text-muted">No payments yet.</li>}
              {d.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-5 py-3">
                  <div><p className="text-sm font-medium">{p.number}</p><p className="text-xs text-muted">{methodLabel[p.method]} · {date(p.paymentDate)}</p></div>
                  <span className="text-sm tabular text-emerald-700">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
