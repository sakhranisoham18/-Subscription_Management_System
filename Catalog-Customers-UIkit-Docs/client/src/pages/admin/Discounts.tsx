import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { BadgePercent, Pencil, Plus, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { date, dateTime, isoDate, money, percent, todayIso } from '@/lib/format';
import { useAction, useListState, useOptions, usePaged } from '@/lib/hooks';
import type { Discount, Plan, Product, TaxRule, HistoryEntry } from '@/lib/types';
import { titleCase } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge, Timeline } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Tabs } from '@/components/ui/menu';
import { Pagination, SortableTh, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';

const amount = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter a non-negative amount');
const schema = z
  .object({
    code: z.string().trim().min(3, 'At least 3 characters').regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only'),
    name: z.string().trim().min(2, 'Enter a name'),
    description: z.string().optional(),
    type: z.enum(['FIXED', 'PERCENTAGE']),
    value: amount,
    minPurchase: z.string().optional(),
    minQuantity: z.string().optional(),
    startsAt: z.string().min(1, 'Required'),
    endsAt: z.string().optional(),
    usageLimit: z.string().optional(),
    scope: z.enum(['ALL', 'PRODUCT', 'PLAN', 'SUBSCRIPTION']),
    productId: z.string().optional(),
    planId: z.string().optional(),
    subscriptionId: z.string().optional(),
    autoApply: z.boolean(),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
  })
  .refine((v) => v.type !== 'PERCENTAGE' || Number(v.value) <= 100, { path: ['value'], message: 'Cannot exceed 100%' })
  .refine((v) => Number(v.value) > 0, { path: ['value'], message: 'Must be greater than zero' })
  .refine((v) => !v.endsAt || v.endsAt >= v.startsAt, { path: ['endsAt'], message: 'Must be on or after the start date' })
  .refine((v) => v.scope !== 'PRODUCT' || v.productId, { path: ['productId'], message: 'Select a product' })
  .refine((v) => v.scope !== 'PLAN' || v.planId, { path: ['planId'], message: 'Select a plan' })
  .refine((v) => v.scope !== 'SUBSCRIPTION' || v.subscriptionId, { path: ['subscriptionId'], message: 'Select a subscription' });
type Values = z.infer<typeof schema>;

function DiscountDialog({ open, onOpenChange, discount }: { open: boolean; onOpenChange: (o: boolean) => void; discount?: Discount }) {
  const products = useOptions<Product>('products', '/products', { status: 'ACTIVE' });
  const plans = useOptions<Plan>('plans', '/plans', { status: 'ACTIVE' });
  const subs = useOptions<{ id: string; number: string; customer: { name: string; companyName: string | null } }>('subs-active', '/subscriptions', { status: 'ACTIVE' });
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (!open) return;
    form.reset(
      discount
        ? {
            ...discount,
            description: discount.description ?? '',
            value: Number(discount.value).toString(),
            minPurchase: discount.minPurchase ? Number(discount.minPurchase).toString() : '',
            minQuantity: discount.minQuantity?.toString() ?? '',
            usageLimit: discount.usageLimit?.toString() ?? '',
            startsAt: isoDate(discount.startsAt),
            endsAt: isoDate(discount.endsAt),
            productId: discount.productId ?? '',
            planId: discount.planId ?? '',
            subscriptionId: discount.subscriptionId ?? '',
          }
        : { code: '', name: '', description: '', type: 'PERCENTAGE', value: '', minPurchase: '', minQuantity: '', startsAt: todayIso(), endsAt: '', usageLimit: '', scope: 'ALL', productId: '', planId: '', subscriptionId: '', autoApply: true, status: 'ACTIVE' },
    );
  }, [open, discount, form]);
  const save = useAction(
    (v: Values) => {
      const body = {
        ...v,
        description: v.description || null,
        minPurchase: v.minPurchase || null,
        minQuantity: v.minQuantity ? Number(v.minQuantity) : null,
        usageLimit: v.usageLimit ? Number(v.usageLimit) : null,
        endsAt: v.endsAt || null,
        productId: v.productId || null,
        planId: v.planId || null,
        subscriptionId: v.subscriptionId || null,
      };
      return discount ? api.patch(`/discounts/${discount.id}`, body) : api.post('/discounts', body);
    },
    { success: 'Discount saved', invalidate: [['discounts'], ['options']], onSuccess: () => onOpenChange(false) },
  );
  const e = form.formState.errors;
  const scope = form.watch('scope');
  const type = form.watch('type');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={discount ? `Edit ${discount.code}` : 'New discount rule'}
      size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>Save discount</Button></>}
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Code" required error={e.code?.message}>{(p) => <Input {...p} className="uppercase" {...form.register('code')} />}</Field>
        <Field label="Name" required error={e.name?.message}>{(p) => <Input {...p} {...form.register('name')} />}</Field>
        <Field label="Type" required>
          {(p) => (
            <Select {...p} {...form.register('type')}>
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED">Fixed amount</option>
            </Select>
          )}
        </Field>
        <Field label={type === 'PERCENTAGE' ? 'Percentage (%)' : 'Amount (₹)'} required error={e.value?.message}>{(p) => <Input {...p} inputMode="decimal" {...form.register('value')} />}</Field>
        <Field label="Minimum purchase (₹)" hint="Net amount of eligible lines">{(p) => <Input {...p} inputMode="decimal" {...form.register('minPurchase')} />}</Field>
        <Field label="Minimum quantity" hint="Total quantity of eligible lines">{(p) => <Input {...p} inputMode="numeric" {...form.register('minQuantity')} />}</Field>
        <Field label="Starts" required error={e.startsAt?.message}>{(p) => <Input {...p} type="date" {...form.register('startsAt')} />}</Field>
        <Field label="Ends" error={e.endsAt?.message} hint="Blank = no end date">{(p) => <Input {...p} type="date" {...form.register('endsAt')} />}</Field>
        <Field label="Usage limit" hint={discount ? `Used ${discount.usedCount} time(s)` : 'Blank = unlimited'}>{(p) => <Input {...p} inputMode="numeric" {...form.register('usageLimit')} />}</Field>
        <Field label="Applies to" required>
          {(p) => (
            <Select {...p} {...form.register('scope')}>
              <option value="ALL">All subscriptions</option>
              <option value="PRODUCT">A specific product</option>
              <option value="PLAN">A specific plan</option>
              <option value="SUBSCRIPTION">One subscription</option>
            </Select>
          )}
        </Field>
        {scope === 'PRODUCT' && (
          <Field label="Product" required error={e.productId?.message} className="sm:col-span-2">
            {(p) => <Select {...p} {...form.register('productId')}><option value="">Select…</option>{products.data?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
          </Field>
        )}
        {scope === 'PLAN' && (
          <Field label="Plan" required error={e.planId?.message} className="sm:col-span-2">
            {(p) => <Select {...p} {...form.register('planId')}><option value="">Select…</option>{plans.data?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
          </Field>
        )}
        {scope === 'SUBSCRIPTION' && (
          <Field label="Subscription" required error={e.subscriptionId?.message} className="sm:col-span-2">
            {(p) => <Select {...p} {...form.register('subscriptionId')}><option value="">Select…</option>{subs.data?.data.map((x) => <option key={x.id} value={x.id}>{x.number} — {x.customer.companyName ?? x.customer.name}</option>)}</Select>}
          </Field>
        )}
        <Field label="Description" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...form.register('description')} />}</Field>
        <div className="space-y-3 sm:col-span-2">
          <Checkbox label="Apply automatically to invoices" description="When eligible, the discount appears on the next invoice without anyone choosing it. Otherwise it is applied manually on quotations." {...form.register('autoApply')} />
          <Checkbox label="Active" checked={form.watch('status') === 'ACTIVE'} onChange={(ev) => form.setValue('status', ev.target.checked ? 'ACTIVE' : 'ARCHIVED')} />
        </div>
      </form>
    </Dialog>
  );
}

interface DiscountDetail extends Discount {
  usages: { id: string; amount: string; usedAt: string; invoice: { id: string; number: string }; customer: { name: string; companyName: string | null } }[];
  history: HistoryEntry[];
}

function DiscountUsageDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['discount', id], queryFn: () => api.get<{ data: DiscountDetail }>(`/discounts/${id}`), enabled: Boolean(id) });
  const d = data?.data;
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()} title={d ? `${d.code} — usage & history` : 'Loading…'} size="lg">
      {d && (
        <div className="space-y-6">
          <p className="text-sm text-ink-soft">
            Used <strong>{d.usedCount}</strong>{d.usageLimit ? ` of ${d.usageLimit}` : ''} time(s).
          </p>
          <Table>
            <THead><Tr><Th>Invoice</Th><Th>Customer</Th><Th>Date</Th><Th className="text-right">Saving</Th></Tr></THead>
            <TBody>
              {d.usages.map((u) => (
                <Tr key={u.id}>
                  <Td className="font-medium">{u.invoice.number}</Td>
                  <Td>{u.customer.companyName ?? u.customer.name}</Td>
                  <Td>{date(u.usedAt)}</Td>
                  <Td className="text-right tabular">{money(u.amount)}</Td>
                </Tr>
              ))}
              {!d.usages.length && <Tr><Td colSpan={4} className="py-6 text-center text-muted">Not used yet.</Td></Tr>}
            </TBody>
          </Table>
          <div>
            <p className="mb-3 text-sm font-medium">Change history</p>
            <Timeline items={d.history.map((h) => ({ id: h.id, title: titleCase(h.action), meta: `${h.actor?.name ?? 'System'} · ${dateTime(h.createdAt)}` }))} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DiscountsTab() {
  const { can } = useAuth();
  const canWrite = can('discounts:write');
  const list = useListState({ sort: 'createdAt' });
  const { data, isLoading, error, refetch } = usePaged<Discount>('discounts', '/discounts', list.query);
  const [dlg, setDlg] = useState<{ open: boolean; discount?: Discount }>({ open: false });
  const [usageId, setUsageId] = useState<string>();
  const today = todayIso();
  const stateOf = (d: Discount) => {
    if (d.status !== 'ACTIVE') return <StatusBadge status="INACTIVE" />;
    if (d.endsAt && isoDate(d.endsAt) < today) return <Badge tone="gray">Expired</Badge>;
    if (isoDate(d.startsAt) > today) return <Badge tone="blue">Scheduled</Badge>;
    if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return <Badge tone="amber">Limit reached</Badge>;
    return <Badge tone="green">Live</Badge>;
  };
  return (
    <>
      <div className="mb-4 flex justify-end">{canWrite && <Button onClick={() => setDlg({ open: true })}><Plus /> New discount</Button>}</div>
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search code or name">
          <FilterSelect label="State" value={list.filters.state} onChange={(v) => list.setFilter('state', v)} options={[['current', 'Live'], ['scheduled', 'Scheduled'], ['expired', 'Expired'], ['exhausted', 'Limit reached']]} />
        </ListToolbar>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Code" field="code" {...list} />
                  <Th>Discount</Th>
                  <Th>Applies to</Th>
                  <Th>Conditions</Th>
                  <SortableTh label="Valid" field="startsAt" {...list} />
                  <Th className="text-right">Used</Th>
                  <Th>State</Th>
                  <Th className="w-20"><span className="sr-only">Actions</span></Th>
                </Tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={8} /> : data?.data.map((d) => (
                  <Tr key={d.id} className="hover:bg-slate-50/60">
                    <Td><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold">{d.code}</span></Td>
                    <Td>
                      <p className="font-medium">{d.type === 'PERCENTAGE' ? `${percent(d.value)} off` : `${money(d.value)} off`}</p>
                      <p className="text-xs text-muted">{d.name}{d.autoApply ? ' · automatic' : ' · manual'}</p>
                    </Td>
                    <Td className="text-ink-soft">{d.scope === 'ALL' ? 'All subscriptions' : d.scope === 'PRODUCT' ? d.product?.name : d.scope === 'PLAN' ? d.plan?.name : d.subscription?.number}</Td>
                    <Td className="text-xs text-ink-soft">
                      {d.minPurchase ? <div>Min. {money(d.minPurchase)}</div> : null}
                      {d.minQuantity ? <div>Min. qty {d.minQuantity}</div> : null}
                      {!d.minPurchase && !d.minQuantity && '—'}
                    </Td>
                    <Td className="text-xs text-ink-soft">{date(d.startsAt)} → {d.endsAt ? date(d.endsAt) : 'no end'}</Td>
                    <Td className="text-right tabular">{d.usedCount}{d.usageLimit ? ` / ${d.usageLimit}` : ''}</Td>
                    <Td>{stateOf(d)}</Td>
                    <Td>
                      <div className="flex">
                        <Button variant="ghost" size="icon" aria-label="Usage and history" onClick={() => setUsageId(d.id)}><Receipt /></Button>
                        {canWrite && <Button variant="ghost" size="icon" aria-label={`Edit ${d.code}`} onClick={() => setDlg({ open: true, discount: d })}><Pencil /></Button>}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={BadgePercent} title="No discounts found" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
      <DiscountDialog open={dlg.open} onOpenChange={(o) => setDlg({ open: o })} discount={dlg.discount} />
      <DiscountUsageDialog id={usageId} onClose={() => setUsageId(undefined)} />
    </>
  );
}

function TaxesTab() {
  const { can } = useAuth();
  const canWrite = can('taxes:write');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['taxes'], queryFn: () => api.get<{ data: TaxRule[] }>('/taxes') });
  const [dlg, setDlg] = useState<{ open: boolean; tax?: TaxRule }>({ open: false });
  const schemaTax = z.object({ name: z.string().trim().min(2, 'Required'), rate: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Enter a rate').refine((v) => Number(v) <= 100, 'Max 100'), description: z.string().optional(), isDefault: z.boolean() });
  const form = useForm<z.infer<typeof schemaTax>>({ resolver: zodResolver(schemaTax) });
  useEffect(() => {
    if (dlg.open) form.reset(dlg.tax ? { name: dlg.tax.name, rate: Number(dlg.tax.rate).toString(), description: dlg.tax.description ?? '', isDefault: dlg.tax.isDefault } : { name: '', rate: '', description: '', isDefault: false });
  }, [dlg, form]);
  const save = useAction((v: z.infer<typeof schemaTax>) => (dlg.tax ? api.patch(`/taxes/${dlg.tax.id}`, v) : api.post('/taxes', v)), { success: 'Tax rule saved', invalidate: [['taxes'], ['options']], onSuccess: () => setDlg({ open: false }) });
  const archive = useAction((t: TaxRule) => api.patch(`/taxes/${t.id}`, { status: t.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }), { success: 'Tax rule updated', invalidate: [['taxes'], ['options']] });

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted">Taxes are calculated automatically from these rules on every line, after discounts.</p>
        {canWrite && <Button onClick={() => setDlg({ open: true })}><Plus /> New tax rule</Button>}
      </div>
      <Card>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <Table>
            <THead><Tr><Th>Name</Th><Th className="text-right">Rate</Th><Th>Description</Th><Th>Status</Th>{canWrite && <Th className="w-40" />}</Tr></THead>
            <TBody>
              {isLoading ? <TableSkeleton cols={5} rows={3} /> : data?.data.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-medium">{t.name} {t.isDefault && <Badge tone="indigo" className="ml-1">Default</Badge>}</Td>
                  <Td className="text-right tabular">{percent(t.rate)}</Td>
                  <Td className="text-ink-soft">{t.description ?? '—'}</Td>
                  <Td><StatusBadge status={t.status} /></Td>
                  {canWrite && (
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDlg({ open: true, tax: t })}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => archive.mutate(t)}>{t.status === 'ACTIVE' ? 'Archive' : 'Restore'}</Button>
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Dialog
        open={dlg.open}
        onOpenChange={(o) => setDlg({ open: o })}
        title={dlg.tax ? 'Edit tax rule' : 'New tax rule'}
        size="sm"
        description={dlg.tax ? 'A new rate applies to invoices generated from now on. Issued invoices keep the rate they were created with.' : undefined}
        footer={<><Button variant="secondary" onClick={() => setDlg({ open: false })}>Cancel</Button><Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>Save</Button></>}
      >
        <div className="space-y-4">
          <Field label="Name" required error={form.formState.errors.name?.message}>{(p) => <Input {...p} {...form.register('name')} />}</Field>
          <Field label="Rate (%)" required error={form.formState.errors.rate?.message}>{(p) => <Input {...p} inputMode="decimal" {...form.register('rate')} />}</Field>
          <Field label="Description">{(p) => <Input {...p} {...form.register('description')} />}</Field>
          <Checkbox label="Default tax rule" description="Used when a product or plan has no tax rule" {...form.register('isDefault')} />
        </div>
      </Dialog>
    </>
  );
}

export default function Discounts() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader
        title="Discounts & taxes"
        description={can('discounts:write') ? 'Discount rules apply themselves to invoices when eligible and stop when they expire or run out.' : 'Only the admin can create or change discount and tax rules.'}
      />
      <Tabs tabs={[{ value: 'discounts', label: 'Discount rules', content: <DiscountsTab /> }, { value: 'taxes', label: 'Tax rules', content: <TaxesTab /> }]} />
    </>
  );
}
