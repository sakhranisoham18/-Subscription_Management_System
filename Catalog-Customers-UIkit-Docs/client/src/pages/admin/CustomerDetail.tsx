import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, FileSignature, Mail, MoreHorizontal, Pencil, Power, Repeat } from 'lucide-react';
import { api } from '@/lib/api';
import { date, dateTime, methodLabel, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { DescriptionList, ErrorState, PageHeader, PageLoader, StatCard, StatusBadge, Timeline } from '@/components/ui/feedback';
import { Menu, MenuItem, Tabs } from '@/components/ui/menu';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { BackLink } from '@/components/layout/AppShell';
import { CustomerFormDialog, type CustomerValues } from '@/components/forms/CustomerForm';
import { PaymentDialog } from '@/components/forms/PaymentDialog';

interface Detail extends CustomerValues {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  hasPortalAccess: boolean;
  user: { lastLoginAt: string | null } | null;
  summary: { outstanding: string; overdue: string; overdueCount: number; totalPaid: string; activeSubscriptions: number };
  subscriptions: { id: string; number: string; status: string; startDate: string; endDate: string | null; nextBillingDate: string | null; total: string; plan: { name: string } }[];
  quotations: { id: string; number: string; status: string; quotationDate: string; validUntil: string; total: string }[];
  invoices: { id: string; number: string; status: string; invoiceDate: string; dueDate: string; total: string; balanceDue: string; isOverdue: boolean }[];
  payments: { id: string; number: string; method: string; amount: string; paymentDate: string; status: string }[];
  activity: { id: string; action: string; createdAt: string; actor: { name: string } | null }[];
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [toggling, setToggling] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<{ data: Detail }>(`/customers/${id}`) });
  const update = useAction((v: Partial<CustomerValues> & { status?: string }) => api.patch(`/customers/${id}`, v), { success: 'Customer updated', invalidate: [['customer', id], ['customers'], ['options'], ['customer-picker'], ['customer-label']] });
  const invite = useAction(() => api.post<{ data: { message: string } }>(`/customers/${id}/invite`), { success: (r) => r.data.message, invalidate: [['customer', id]] });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const c = data.data;
  const address = [c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode, c.country].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader
        back={<BackLink to="/customers">Customers</BackLink>}
        title={
          <span className="flex items-center gap-3">
            {c.companyName ?? c.name} <StatusBadge status={c.status} />
          </span>
        }
        description={`${c.companyName ? `${c.name} · ` : ''}${c.email} · customer since ${date(c.createdAt)}`}
        actions={
          can('customers:write') && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/quotations/new?customerId=${c.id}`)}>
                <FileSignature /> New quotation
              </Button>
              <Button variant="secondary" onClick={() => setPaying(true)} disabled={c.status !== 'ACTIVE'}>
                <CreditCard /> Record payment
              </Button>
              <Menu trigger={<Button variant="secondary" size="icon" aria-label="More actions"><MoreHorizontal /></Button>}>
                <MenuItem onSelect={() => setEditing(true)}><Pencil /> Edit details</MenuItem>
                <MenuItem onSelect={() => navigate(`/subscriptions/new?customerId=${c.id}`)} disabled={c.status !== 'ACTIVE'}><Repeat /> New subscription</MenuItem>
                <MenuItem onSelect={() => invite.mutate()} disabled={c.status !== 'ACTIVE'}><Mail /> {c.hasPortalAccess ? 'Resend portal invite' : 'Invite to portal'}</MenuItem>
                <MenuItem onSelect={() => setToggling(true)} danger={c.status === 'ACTIVE'}><Power /> {c.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</MenuItem>
              </Menu>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active subscriptions" value={c.summary.activeSubscriptions} />
        <StatCard label="Outstanding" value={money(c.summary.outstanding)} tone="blue" />
        <StatCard label="Overdue" value={money(c.summary.overdue)} hint={`${c.summary.overdueCount} invoices`} tone="red" />
        <StatCard label="Total paid" value={money(c.summary.totalPaid)} tone="green" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs
            tabs={[
              {
                value: 'subs',
                label: `Subscriptions (${c.subscriptions.length})`,
                content: (
                  <Card>
                    <Table>
                      <THead><Tr><Th>Number</Th><Th>Plan</Th><Th>Status</Th><Th>Next billing</Th><Th>Ends</Th><Th className="text-right">Amount</Th></Tr></THead>
                      <TBody>
                        {c.subscriptions.map((s) => (
                          <Tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/subscriptions/${s.id}`)}>
                            <Td className="font-medium">{s.number}</Td>
                            <Td>{s.plan.name}</Td>
                            <Td><StatusBadge status={s.status} /></Td>
                            <Td>{date(s.nextBillingDate)}</Td>
                            <Td>{date(s.endDate)}</Td>
                            <Td className="text-right tabular">{money(s.total)}</Td>
                          </Tr>
                        ))}
                        {!c.subscriptions.length && <Tr><Td colSpan={6} className="py-8 text-center text-muted">No subscriptions yet.</Td></Tr>}
                      </TBody>
                    </Table>
                  </Card>
                ),
              },
              {
                value: 'invoices',
                label: `Invoices (${c.invoices.length})`,
                content: (
                  <Card>
                    <Table>
                      <THead><Tr><Th>Invoice</Th><Th>Date</Th><Th>Due</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th></Tr></THead>
                      <TBody>
                        {c.invoices.map((i) => (
                          <Tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/invoices/${i.id}`)}>
                            <Td className="font-medium">{i.number}</Td>
                            <Td>{date(i.invoiceDate)}</Td>
                            <Td>{date(i.dueDate)}</Td>
                            <Td><StatusBadge status={i.isOverdue ? 'OVERDUE' : i.status} kind="invoice" /></Td>
                            <Td className="text-right tabular">{money(i.total)}</Td>
                            <Td className="text-right tabular">{money(i.balanceDue)}</Td>
                          </Tr>
                        ))}
                        {!c.invoices.length && <Tr><Td colSpan={6} className="py-8 text-center text-muted">No invoices yet.</Td></Tr>}
                      </TBody>
                    </Table>
                  </Card>
                ),
              },
              {
                value: 'quotes',
                label: `Quotations (${c.quotations.length})`,
                content: (
                  <Card>
                    <Table>
                      <THead><Tr><Th>Quotation</Th><Th>Date</Th><Th>Valid until</Th><Th>Status</Th><Th className="text-right">Total</Th></Tr></THead>
                      <TBody>
                        {c.quotations.map((q) => (
                          <Tr key={q.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/quotations/${q.id}`)}>
                            <Td className="font-medium">{q.number}</Td>
                            <Td>{date(q.quotationDate)}</Td>
                            <Td>{date(q.validUntil)}</Td>
                            <Td><StatusBadge status={q.status} /></Td>
                            <Td className="text-right tabular">{money(q.total)}</Td>
                          </Tr>
                        ))}
                        {!c.quotations.length && <Tr><Td colSpan={5} className="py-8 text-center text-muted">No quotations yet.</Td></Tr>}
                      </TBody>
                    </Table>
                  </Card>
                ),
              },
              {
                value: 'payments',
                label: `Payments (${c.payments.length})`,
                content: (
                  <Card>
                    <Table>
                      <THead><Tr><Th>Payment</Th><Th>Date</Th><Th>Method</Th><Th>Status</Th><Th className="text-right">Amount</Th></Tr></THead>
                      <TBody>
                        {c.payments.map((p) => (
                          <Tr key={p.id}>
                            <Td className="font-medium"><Link to={`/payments?search=${p.number}`} className="hover:underline">{p.number}</Link></Td>
                            <Td>{date(p.paymentDate)}</Td>
                            <Td>{methodLabel[p.method]}</Td>
                            <Td><StatusBadge status={p.status} /></Td>
                            <Td className="text-right tabular">{money(p.amount)}</Td>
                          </Tr>
                        ))}
                        {!c.payments.length && <Tr><Td colSpan={5} className="py-8 text-center text-muted">No payments yet.</Td></Tr>}
                      </TBody>
                    </Table>
                  </Card>
                ),
              },
            ]}
          />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Billing details" actions={can('customers:write') && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button>} />
            <CardBody>
              <DescriptionList
                cols={1}
                items={[
                  ['Contact', c.name],
                  ['Email', c.email],
                  ['Phone', c.phone || '—'],
                  ['Billing contact', c.billingContact || '—'],
                  ['Address', address || '—'],
                  ['Tax ID', c.taxId || '—'],
                  ['Portal access', c.hasPortalAccess ? <Badge tone="indigo">Enabled{c.user?.lastLoginAt ? ` · last login ${date(c.user.lastLoginAt)}` : ''}</Badge> : <span className="text-muted">Not invited</span>],
                  ['Notes', c.notes || '—'],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <Timeline items={c.activity.map((a) => ({ id: a.id, title: titleCase(a.action), meta: `${a.actor?.name ?? 'System'} · ${dateTime(a.createdAt)}` }))} />
            </CardBody>
          </Card>
        </div>
      </div>

      <CustomerFormDialog open={editing} onOpenChange={setEditing} title="Edit customer" initial={c} onSubmit={(v) => update.mutateAsync(v)} />
      <PaymentDialog open={paying} onOpenChange={setPaying} customerId={c.id} />
      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={c.status === 'ACTIVE' ? 'Deactivate customer?' : 'Reactivate customer?'}
        description={c.status === 'ACTIVE' ? 'They will no longer be selectable for new sales and their portal login will be disabled. Existing records are kept.' : 'The customer becomes selectable for new sales again.'}
        tone={c.status === 'ACTIVE' ? 'danger' : 'primary'}
        confirmLabel={c.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        loading={update.isPending}
        onConfirm={async () => {
          await update.mutateAsync({ status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
          setToggling(false);
        }}
      />
    </>
  );
}
