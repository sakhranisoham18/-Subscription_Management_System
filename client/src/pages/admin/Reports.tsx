import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileDown } from 'lucide-react';
import { api, errorMessage, openFile, qs } from '@/lib/api';
import { addDaysIso, frequencyLabel, methodLabel, money, todayIso } from '@/lib/format';
import { useOptions } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import type { Plan } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader, StatCard } from '@/components/ui/feedback';
import { Menu, MenuItem } from '@/components/ui/menu';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { HBarChart, RevenueChart, StatusDonut } from '@/components/charts';
import { CustomerPicker } from '@/components/CustomerPicker';

interface Report {
  period: { from: string; to: string };
  activeSubscriptions: number;
  subscriptionsByStatus: Record<string, number>;
  recurring: { mrr: string; arr: string; byFrequency: Record<string, { count: number; mrr: string }> };
  invoiced: { amount: string; count: number; tax: string };
  collected: { amount: string; count: number };
  discountsGiven: string;
  outstanding: string;
  outstandingCount: number;
  overdue: string;
  overdueCount: number;
  paymentsByMethod: { method: string; count: number; amount: string }[];
  invoicesByStatus: { status: string; count: number; amount: string }[];
  revenueSeries: { month: string; invoiced: string; collected: string; invoiceCount: number }[];
  ageing: { bucket: string; amount: string; count: number }[];
  topCustomers: { customerId: string; name: string; invoiced: string; outstanding: string }[];
  definitions: string[];
}

const PRESETS: [string, () => [string, string]][] = [
  ['This month', () => [todayIso().slice(0, 8) + '01', todayIso()]],
  ['Last 30 days', () => [addDaysIso(todayIso(), -29), todayIso()]],
  ['Last 90 days', () => [addDaysIso(todayIso(), -89), todayIso()]],
  ['Last 12 months', () => {
    const d = new Date(`${todayIso()}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 11, 1);
    return [d.toISOString().slice(0, 10), todayIso()];
  }],
  ['Year to date', () => [todayIso().slice(0, 4) + '-01-01', todayIso()]],
];

export default function Reports() {
  const [from, setFrom] = useState(PRESETS[3][1]()[0]);
  const [to, setTo] = useState(todayIso());
  const [billingFrequency, setFreq] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [planId, setPlanId] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const plans = useOptions<Plan>('plans', '/plans');
  const filters = { from, to, billingFrequency, customerId, planId, invoiceStatus, paymentMethod };
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['report', filters], queryFn: () => api.get<{ data: Report }>('/reports/finance', filters) });
  const exp = (path: string, kind?: string) =>
    openFile(`/reports/finance/${path}${qs({ ...filters, kind })}`, { download: true }).catch((e) => toast.error(errorMessage(e)));

  return (
    <>
      <PageHeader
        title="Revenue & finance"
        description="Active subscriptions, recurring revenue, collections and receivables — calculated from invoices and payments."
        actions={
          <Menu trigger={<Button><Download /> Export</Button>}>
            <MenuItem onSelect={() => exp('export.pdf')}><FileDown /> Summary (PDF)</MenuItem>
            <MenuItem onSelect={() => exp('export.csv', 'summary')}><FileDown /> Summary (CSV)</MenuItem>
            <MenuItem onSelect={() => exp('export.csv', 'invoices')}><FileDown /> Invoices (CSV)</MenuItem>
            <MenuItem onSelect={() => exp('export.csv', 'payments')}><FileDown /> Payments (CSV)</MenuItem>
          </Menu>
        }
      />
      <Card className="mb-6">
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(([label, fn]) => (
              <Button key={label} variant="secondary" size="sm" onClick={() => { const [f, t] = fn(); setFrom(f); setTo(t); }}>{label}</Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            <Field label="From">{(p) => <Input {...p} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="To">{(p) => <Input {...p} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
            <Field label="Billing">{(p) => <Select {...p} value={billingFrequency} onChange={(e) => setFreq(e.target.value)}><option value="">All</option>{Object.entries(frequencyLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
            <Field label="Plan">{(p) => <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">All</option>{plans.data?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Field label="Customer">{(p) => <CustomerPicker {...p} allowClear activeOnly={false} placeholder="All customers" value={customerId} onChange={setCustomerId} />}</Field>
            <Field label="Invoice status">{(p) => <Select {...p} value={invoiceStatus} onChange={(e) => setInvoiceStatus(e.target.value)}><option value="">Excl. drafts</option>{['CONFIRMED', 'PARTIALLY_PAID', 'PAID'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
            <Field label="Payment method">{(p) => <Select {...p} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="">All</option>{Object.entries(methodLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          </div>
        </CardBody>
      </Card>

      {isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} onRetry={refetch} /> : (
        <div className={isFetching ? 'opacity-70 transition-opacity' : ''}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Invoiced revenue" value={money(data.data.invoiced.amount)} hint={`${data.data.invoiced.count} invoices · tax ${money(data.data.invoiced.tax)}`} />
            <StatCard label="Collected revenue" value={money(data.data.collected.amount)} hint={`${data.data.collected.count} payments`} tone="green" />
            <StatCard label="Outstanding (today)" value={money(data.data.outstanding)} hint={`${data.data.outstandingCount} open invoices`} tone="blue" />
            <StatCard label="Overdue (today)" value={money(data.data.overdue)} hint={`${data.data.overdueCount} invoices past due`} tone="red" />
            <StatCard label="MRR" value={money(data.data.recurring.mrr)} hint="Active subscriptions, normalised monthly, before tax" tone="violet" />
            <StatCard label="ARR" value={money(data.data.recurring.arr)} tone="violet" />
            <StatCard label="Active subscriptions" value={data.data.activeSubscriptions} tone="green" />
            <StatCard label="Discounts given" value={money(data.data.discountsGiven)} tone="amber" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Revenue over time" description="Invoiced vs collected per month" />
              <CardBody><RevenueChart data={data.data.revenueSeries} height={300} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Subscriptions by status" />
              <CardBody><StatusDonut counts={data.data.subscriptionsByStatus} height={150} /></CardBody>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Payments by method" />
              <CardBody>
                {data.data.paymentsByMethod.length ? <HBarChart data={data.data.paymentsByMethod.map((m) => ({ label: methodLabel[m.method], value: Number(m.amount) }))} /> : <p className="text-sm text-muted">No payments in this period.</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Overdue ageing" description="Unpaid balance by days past due" />
              <Table>
                <THead><Tr><Th>Days overdue</Th><Th className="text-right">Invoices</Th><Th className="text-right">Amount</Th></Tr></THead>
                <TBody>
                  {data.data.ageing.map((a) => (
                    <Tr key={a.bucket}><Td>{a.bucket}</Td><Td className="text-right tabular">{a.count}</Td><Td className="text-right tabular">{money(a.amount)}</Td></Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="MRR by billing frequency" />
              <Table>
                <THead><Tr><Th>Frequency</Th><Th className="text-right">Active</Th><Th className="text-right">MRR</Th></Tr></THead>
                <TBody>
                  {Object.entries(data.data.recurring.byFrequency).map(([k, v]) => (
                    <Tr key={k}><Td>{frequencyLabel[k]}</Td><Td className="text-right tabular">{v.count}</Td><Td className="text-right tabular">{money(v.mrr)}</Td></Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top customers" description="By invoiced revenue in the period" />
              <Table>
                <THead><Tr><Th>Customer</Th><Th className="text-right">Invoiced</Th><Th className="text-right">Unpaid</Th></Tr></THead>
                <TBody>
                  {data.data.topCustomers.map((t) => (
                    <Tr key={t.customerId}><Td>{t.name}</Td><Td className="text-right tabular">{money(t.invoiced)}</Td><Td className="text-right tabular">{money(t.outstanding)}</Td></Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="Invoices by status" description="Invoices dated in the period" />
              <Table>
                <THead><Tr><Th>Status</Th><Th className="text-right">Count</Th><Th className="text-right">Amount</Th></Tr></THead>
                <TBody>
                  {data.data.invoicesByStatus.map((s) => (
                    <Tr key={s.status}><Td>{titleCase(s.status)}</Td><Td className="text-right tabular">{s.count}</Td><Td className="text-right tabular">{money(s.amount)}</Td></Tr>
                  ))}
                </TBody>
              </Table>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader title="How these numbers are calculated" />
            <CardBody>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
                {data.data.definitions.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
