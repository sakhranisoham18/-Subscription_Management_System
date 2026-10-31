import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Check, CheckCircle2, MoreHorizontal, Pause, Pencil, Play, Power, RefreshCcw, Send, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { date, dateTime, intervalLabel, isoDate, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { DocLine, SubscriptionStatus } from '@/lib/types';
import { cn, titleCase } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Field, Input } from '@/components/ui/primitives';
import { DescriptionList, ErrorState, PageHeader, PageLoader, StatusBadge, Timeline } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator, Tabs } from '@/components/ui/menu';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { BackLink } from '@/components/layout/AppShell';
import { DocLinesTable, Totals } from '@/components/DocLines';

interface Sub {
  id: string;
  number: string;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  billingFrequency: string;
  billingInterval: number;
  paymentTermsDays: number;
  autoRenew: boolean;
  autoClose: boolean;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  closeReason: string | null;
  createdAt: string;
  isExpired: boolean;
  customer: { id: string; name: string; companyName: string | null; email: string };
  plan: { id: string; name: string; allowPause: boolean; allowEarlyClose: boolean; allowRenew: boolean; termLength: number | null };
  discount: { code: string; name: string } | null;
  quotation: { id: string; number: string; status: string } | null;
  createdBy: { name: string } | null;
  lines: DocLine[];
  events: { id: string; type: string; message: string; createdAt: string; actor: { name: string } | null; toStatus: string | null }[];
  invoices: { id: string; number: string; status: string; invoiceDate: string; periodStart: string | null; periodEnd: string | null; total: string; balanceDue: string; isOverdue: boolean }[];
  changeRequests: { id: string; type: string; message: string | null; createdAt: string }[];
  upcomingBillingDates: string[];
}

const STEPS: SubscriptionStatus[] = ['DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE', 'CLOSED'];

function Stepper({ status }: { status: SubscriptionStatus }) {
  const current = status === 'PAUSED' ? 3 : STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Lifecycle">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                active ? 'bg-brand-600 text-white' : done ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-muted',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done && <Check className="size-3" />}
              {s === 'ACTIVE' && status === 'PAUSED' ? 'Active (paused)' : titleCase(s)}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export default function SubscriptionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can('subscriptions:write');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['subscription', id], queryFn: () => api.get<{ data: Sub }>(`/subscriptions/${id}`) });
  const inv = [['subscription', id], ['subscriptions'], ['dashboard'], ['options']];
  const useSubAction = (path: string, success: string) => useAction((body: object = {}) => api.post(`/subscriptions/${id}/${path}`, body), { success, invalidate: inv });
  const confirm = useSubAction('confirm', 'Subscription confirmed');
  const activate = useSubAction('activate', 'Subscription activated — billing schedule started');
  const pause = useSubAction('pause', 'Subscription paused');
  const resume = useSubAction('resume', 'Subscription resumed');
  const close = useSubAction('close', 'Subscription closed');
  const renew = useSubAction('renew', 'Subscription renewed');
  const sendQuote = useSubAction('send-quotation', 'Quotation emailed to the customer');
  const [dialog, setDialog] = useState<null | 'pause' | 'close' | 'renew' | 'schedule'>(null);
  const [nextDate, setNextDate] = useState('');
  const [periods, setPeriods] = useState('');
  const setSchedule = useAction(() => api.patch(`/subscriptions/${id}/next-billing-date`, { nextBillingDate: nextDate }), { success: 'Next billing date updated', invalidate: inv, onSuccess: () => setDialog(null) });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const s = data.data;
  const running = s.status === 'ACTIVE' || s.status === 'PAUSED';
  const canRenew = s.plan.allowRenew && ((running && s.endDate) || (s.status === 'CLOSED' && ['EXPIRED', 'NOT_RENEWED'].includes(s.closeReason ?? '')));

  return (
    <>
      <PageHeader
        back={<BackLink to="/subscriptions">Subscriptions</BackLink>}
        title={<span className="flex flex-wrap items-center gap-3">{s.number} <StatusBadge status={s.status} />{s.closeReason && <Badge>{titleCase(s.closeReason)}</Badge>}{s.isExpired && <Badge tone="amber">Past expiry — awaiting renewal</Badge>}</span>}
        description={<><Link to={`/customers/${s.customer.id}`} className="text-brand-600 hover:underline">{s.customer.companyName ?? s.customer.name}</Link> · {s.plan.name} · {intervalLabel(s.billingFrequency, s.billingInterval)}</>}
        actions={
          canWrite && (
            <>
              {['DRAFT', 'QUOTATION'].includes(s.status) && <Button variant="secondary" loading={sendQuote.isPending} onClick={() => sendQuote.mutate({})}><Send /> {s.status === 'QUOTATION' ? 'Resend quotation' : 'Send as quotation'}</Button>}
              {['DRAFT', 'QUOTATION'].includes(s.status) && <Button loading={confirm.isPending} onClick={() => confirm.mutate({})}><CheckCircle2 /> Confirm</Button>}
              {s.status === 'CONFIRMED' && <Button loading={activate.isPending} onClick={() => activate.mutate({})}><Zap /> Activate</Button>}
              {s.status === 'PAUSED' && <Button loading={resume.isPending} onClick={() => resume.mutate({})}><Play /> Resume</Button>}
              {s.status !== 'CLOSED' && <Button variant="secondary" onClick={() => navigate(`/subscriptions/${s.id}/edit`)}><Pencil /> Edit</Button>}
              <Menu trigger={<Button variant="secondary" size="icon" aria-label="More actions"><MoreHorizontal /></Button>}>
                {s.status === 'ACTIVE' && <MenuItem disabled={!s.plan.allowPause} onSelect={() => setDialog('pause')}><Pause /> Pause{!s.plan.allowPause && ' (not allowed by plan)'}</MenuItem>}
                {running && can('billing:run') && <MenuItem onSelect={() => { setNextDate(isoDate(s.nextBillingDate)); setDialog('schedule'); }}><CalendarClock /> Change next billing date</MenuItem>}
                <MenuItem disabled={!canRenew} onSelect={() => { setPeriods(String(s.plan.termLength ?? 1)); setDialog('renew'); }}><RefreshCcw /> Renew{!s.plan.allowRenew ? ' (not allowed by plan)' : ''}</MenuItem>
                {s.status !== 'CLOSED' && <MenuSeparator />}
                {s.status !== 'CLOSED' && (
                  <MenuItem danger disabled={running && !s.plan.allowEarlyClose} onSelect={() => setDialog('close')}>
                    <Power /> {running ? `Close early${!s.plan.allowEarlyClose ? ' (not allowed by plan)' : ''}` : 'Cancel'}
                  </MenuItem>
                )}
              </Menu>
            </>
          )
        }
      />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <Stepper status={s.status} />
          {s.status === 'ACTIVE' && s.nextBillingDate && (
            <p className="text-sm text-ink-soft">Next invoice <strong className="text-ink">{date(s.nextBillingDate)}</strong> · {money(s.total)}</p>
          )}
        </CardBody>
      </Card>

      {s.changeRequests.length > 0 && (
        <Link to="/requests" className="mb-6 block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          The customer has requested to <strong>{s.changeRequests[0].type.toLowerCase()}</strong> this subscription{s.changeRequests[0].message ? `: “${s.changeRequests[0].message}”` : ''}. Review the request →
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs
            tabs={[
              {
                value: 'lines',
                label: 'Lines',
                content: (
                  <Card>
                    <DocLinesTable lines={s.lines} />
                    <Totals subtotal={s.subtotal} discountTotal={s.discountTotal} taxTotal={s.taxTotal} total={s.total} discountLabel={s.discount?.code} />
                    <p className="border-t border-line px-5 py-3 text-xs text-muted">Recurring amount per billing period. Automatic discounts are re-evaluated on every invoice (dates, minimums and usage limits).</p>
                  </Card>
                ),
              },
              {
                value: 'invoices',
                label: `Invoices (${s.invoices.length})`,
                content: (
                  <Card>
                    <Table>
                      <THead><Tr><Th>Invoice</Th><Th>Period</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th></Tr></THead>
                      <TBody>
                        {s.invoices.map((i) => (
                          <Tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/invoices/${i.id}`)}>
                            <Td className="font-medium">{i.number}<p className="text-xs font-normal text-muted">{date(i.invoiceDate)}</p></Td>
                            <Td className="text-ink-soft">{i.periodStart ? `${date(i.periodStart)} – ${date(i.periodEnd)}` : 'One-off'}</Td>
                            <Td><StatusBadge status={i.isOverdue ? 'OVERDUE' : i.status} kind="invoice" /></Td>
                            <Td className="text-right tabular">{money(i.total)}</Td>
                            <Td className="text-right tabular">{money(i.balanceDue)}</Td>
                          </Tr>
                        ))}
                        {!s.invoices.length && <Tr><Td colSpan={5} className="py-8 text-center text-muted">No invoices yet. They are generated on each billing date once the subscription is active.</Td></Tr>}
                      </TBody>
                    </Table>
                  </Card>
                ),
              },
              {
                value: 'history',
                label: 'History',
                content: (
                  <Card>
                    <CardBody>
                      <Timeline items={s.events.map((e) => ({ id: e.id, title: e.message, meta: `${e.actor?.name ?? 'System'} · ${dateTime(e.createdAt)}`, tone: e.type === 'INVOICED' ? 'gray' : 'brand' }))} />
                    </CardBody>
                  </Card>
                ),
              },
            ]}
          />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                cols={1}
                items={[
                  ['Customer', `${s.customer.companyName ?? s.customer.name} · ${s.customer.email}`],
                  ['Plan', s.plan.name],
                  ['Start date', date(s.startDate)],
                  ['Expiry date', s.endDate ? date(s.endDate) : 'Open-ended'],
                  ['Billing', `${intervalLabel(s.billingFrequency, s.billingInterval)} in advance`],
                  ['Payment terms', `${s.paymentTermsDays} days`],
                  ['At expiry', s.autoRenew ? 'Renews automatically' : s.autoClose ? 'Closes automatically' : 'Staff decide'],
                  ['Discount rule', s.discount ? `${s.discount.code} — ${s.discount.name}` : '—'],
                  ['Quotation', s.quotation ? <Link className="text-brand-600 hover:underline" to={`/quotations/${s.quotation.id}`}>{s.quotation.number}</Link> : '—'],
                  ['Created', `${dateTime(s.createdAt)}${s.createdBy ? ` by ${s.createdBy.name}` : ''}`],
                  ['Notes', s.notes || '—'],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Upcoming billing" description={s.status === 'PAUSED' ? 'Paused — no invoices until resumed' : undefined} />
            <CardBody>
              {s.upcomingBillingDates.length ? (
                <ul className="space-y-2 text-sm">
                  {s.upcomingBillingDates.map((d, i) => (
                    <li key={d} className="flex justify-between">
                      <span className={i === 0 ? 'font-medium' : 'text-ink-soft'}>{date(d)}</span>
                      <span className="tabular text-ink-soft">{money(s.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{s.status === 'CONFIRMED' ? 'Starts when the subscription is activated.' : 'No upcoming billing.'}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={dialog === 'pause'} onOpenChange={(o) => !o && setDialog(null)} title="Pause subscription?" description="No invoices are generated while paused. Periods that fall inside the pause are not billed." reasonLabel="Reason (optional)" confirmLabel="Pause" loading={pause.isPending} onConfirm={async (reason) => { await pause.mutateAsync({ reason }); setDialog(null); }} />
      <ConfirmDialog
        open={dialog === 'close'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={running ? 'Close subscription early?' : 'Cancel subscription?'}
        description={running ? 'Billing stops immediately. Issued invoices are not affected.' : 'The subscription will be cancelled before it starts.'}
        reasonLabel="Reason"
        reasonRequired
        tone="danger"
        confirmLabel={running ? 'Close subscription' : 'Cancel subscription'}
        loading={close.isPending}
        onConfirm={async (reason) => { await close.mutateAsync({ reason }); setDialog(null); }}
      />
      <Dialog open={dialog === 'renew'} onOpenChange={(o) => !o && setDialog(null)} title="Renew subscription" size="sm" footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={renew.isPending} onClick={async () => { await renew.mutateAsync({ periods: Number(periods) || undefined }); setDialog(null); }}>Renew</Button></>}>
        <Field label="Extend by (billing periods)" hint={s.status === 'CLOSED' ? 'Reopens the subscription with a new term starting today.' : `Current expiry ${date(s.endDate)}.`}>
          {(p) => <Input {...p} type="number" min={1} value={periods} onChange={(e) => setPeriods(e.target.value)} />}
        </Field>
      </Dialog>
      <Dialog open={dialog === 'schedule'} onOpenChange={(o) => !o && setDialog(null)} title="Change next billing date" size="sm" description="Used to correct a schedule (or to demo billing). Already-invoiced periods are never billed twice." footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={setSchedule.isPending} onClick={() => setSchedule.mutate()}>Save</Button></>}>
        <Field label="Next billing date">{(p) => <Input {...p} type="date" min={isoDate(s.startDate)} max={isoDate(s.endDate) || undefined} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />}</Field>
      </Dialog>
    </>
  );
}
