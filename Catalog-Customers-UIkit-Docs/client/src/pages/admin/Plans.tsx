import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Boxes, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { date, frequencyLabel, intervalLabel, isoDate, money, todayIso } from '@/lib/format';
import { useAction, useListState, useOptions, usePaged } from '@/lib/hooks';
import type { Plan, TaxRule } from '@/lib/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Pagination, SortableTh, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter a plan name'),
    description: z.string().optional(),
    billingFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    billingInterval: z.coerce.number().int().min(1, 'At least 1'),
    price: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter a non-negative amount'),
    minQuantity: z.coerce.number().int().min(1, 'At least 1'),
    availableFrom: z.string().min(1, 'Required'),
    availableUntil: z.string().optional(),
    termLength: z.string().optional(),
    autoClose: z.boolean(),
    autoRenew: z.boolean(),
    allowPause: z.boolean(),
    allowEarlyClose: z.boolean(),
    allowRenew: z.boolean(),
    taxRuleId: z.string().optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  })
  .refine((v) => !v.availableUntil || v.availableUntil >= v.availableFrom, { path: ['availableUntil'], message: 'Must be on or after the start date' })
  .refine((v) => !v.termLength || /^\d+$/.test(v.termLength), { path: ['termLength'], message: 'Whole number of periods' });
type Values = z.input<typeof schema>;

function PlanDialog({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (o: boolean) => void; plan?: Plan }) {
  const taxes = useOptions<TaxRule>('taxes', '/taxes', { status: 'ACTIVE' });
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (!open) return;
    form.reset(
      plan
        ? {
            ...plan,
            description: plan.description ?? '',
            price: Number(plan.price).toFixed(2),
            availableFrom: isoDate(plan.availableFrom),
            availableUntil: isoDate(plan.availableUntil),
            termLength: plan.termLength ? String(plan.termLength) : '',
            taxRuleId: plan.taxRuleId ?? '',
          }
        : { name: '', description: '', billingFrequency: 'MONTHLY', billingInterval: 1, price: '', minQuantity: 1, availableFrom: todayIso(), availableUntil: '', termLength: '', autoClose: true, autoRenew: false, allowPause: true, allowEarlyClose: true, allowRenew: true, taxRuleId: '', status: 'ACTIVE' },
    );
  }, [open, plan, form]);
  const save = useAction(
    (v: Values) => {
      const body = { ...v, termLength: v.termLength ? Number(v.termLength) : null, availableUntil: v.availableUntil || null, taxRuleId: v.taxRuleId || null, description: v.description || null };
      return plan ? api.patch(`/plans/${plan.id}`, body) : api.post('/plans', body);
    },
    { success: plan ? 'Plan updated' : 'Plan created', invalidate: [['plans'], ['options']], onSuccess: () => onOpenChange(false) },
  );
  const e = form.formState.errors;
  const freq = form.watch('billingFrequency');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={plan ? `Edit ${plan.name}` : 'New subscription plan'}
      description={plan ? 'Changes apply to new subscriptions. Existing subscriptions keep their billing frequency, prices and lines.' : undefined}
      size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>Save plan</Button></>}
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Plan name" required error={e.name?.message} className="sm:col-span-2">{(p) => <Input {...p} {...form.register('name')} />}</Field>
        <Field label="Description" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...form.register('description')} />}</Field>
        <Field label="Price per period (₹)" required error={e.price?.message} hint="Per unit of quantity (seat)">{(p) => <Input {...p} inputMode="decimal" {...form.register('price')} />}</Field>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label="Billing frequency" required>
            {(p) => (
              <Select {...p} {...form.register('billingFrequency')}>
                {Object.entries(frequencyLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Every" error={e.billingInterval?.message}>{(p) => <Input {...p} type="number" min={1} {...form.register('billingInterval')} />}</Field>
        </div>
        <Field label="Minimum quantity" required error={e.minQuantity?.message}>{(p) => <Input {...p} type="number" min={1} {...form.register('minQuantity')} />}</Field>
        <Field label="Term length (periods)" error={e.termLength?.message} hint={`Blank = open-ended. E.g. 12 ${freq === 'MONTHLY' ? 'months' : 'periods'}.`}>{(p) => <Input {...p} inputMode="numeric" {...form.register('termLength')} />}</Field>
        <Field label="Available from" required error={e.availableFrom?.message}>{(p) => <Input {...p} type="date" {...form.register('availableFrom')} />}</Field>
        <Field label="Available until" error={e.availableUntil?.message} hint="Blank = no end date">{(p) => <Input {...p} type="date" {...form.register('availableUntil')} />}</Field>
        <Field label="Tax rule">
          {(p) => (
            <Select {...p} {...form.register('taxRuleId')}>
              <option value="">Default tax rule</option>
              {taxes.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(p) => (
            <Select {...p} {...form.register('status')}>
              <option value="ACTIVE">Active — can be sold</option>
              <option value="DRAFT">Draft — not yet sellable</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          )}
        </Field>
        <fieldset className="space-y-3 rounded-lg border border-line p-4 sm:col-span-2">
          <legend className="px-1 text-sm font-medium">Lifecycle options</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox label="Close automatically at end of term" description="Subscriptions close when the term ends" {...form.register('autoClose')} />
            <Checkbox label="Renew automatically" description="Extend by one term instead of closing" {...form.register('autoRenew')} />
            <Checkbox label="Allow pausing" {...form.register('allowPause')} />
            <Checkbox label="Allow closing early" {...form.register('allowEarlyClose')} />
            <Checkbox label="Allow manual renewal" {...form.register('allowRenew')} />
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

export default function Plans() {
  const { can } = useAuth();
  const canWrite = can('plans:write');
  const list = useListState({ sort: 'createdAt' });
  const { data, isLoading, error, refetch } = usePaged<Plan>('plans', '/plans', list.query);
  const [dlg, setDlg] = useState<{ open: boolean; plan?: Plan }>({ open: false });

  return (
    <>
      <PageHeader
        title="Subscription plans"
        description="What each plan costs, how often it bills and what customers can do with it."
        actions={canWrite && <Button onClick={() => setDlg({ open: true })}><Plus /> New plan</Button>}
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search plans">
          <FilterSelect label="Frequency" value={list.filters.billingFrequency} onChange={(v) => list.setFilter('billingFrequency', v)} options={Object.entries(frequencyLabel)} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[['ACTIVE', 'Active'], ['DRAFT', 'Draft'], ['ARCHIVED', 'Archived']]} />
        </ListToolbar>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Plan" field="name" {...list} />
                  <SortableTh label="Price" field="price" {...list} className="text-right" />
                  <SortableTh label="Billing" field="billingFrequency" {...list} />
                  <Th className="text-right">Min qty</Th>
                  <Th>Availability</Th>
                  <Th>Options</Th>
                  <Th className="text-right">Active subs</Th>
                  <Th>Status</Th>
                  {canWrite && <Th className="w-10"><span className="sr-only">Edit</span></Th>}
                </Tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={9} /> : data?.data.map((p) => (
                  <Tr key={p.id} className="hover:bg-slate-50/60">
                    <Td>
                      <p className="font-medium">{p.name}</p>
                      {p.description && <p className="max-w-xs truncate text-xs text-muted">{p.description}</p>}
                    </Td>
                    <Td className="text-right tabular">{money(p.price)}</Td>
                    <Td>{intervalLabel(p.billingFrequency, p.billingInterval)}{p.termLength ? <span className="text-xs text-muted"> · {p.termLength}-period term</span> : ''}</Td>
                    <Td className="text-right tabular">{p.minQuantity}</Td>
                    <Td className="text-xs text-ink-soft">{date(p.availableFrom)} → {p.availableUntil ? date(p.availableUntil) : 'no end'}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {p.autoRenew && <Badge tone="green">Auto-renew</Badge>}
                        {p.autoClose && !p.autoRenew && <Badge>Auto-close</Badge>}
                        {p.allowPause && <Badge tone="amber">Pause</Badge>}
                        {p.allowEarlyClose && <Badge tone="gray">Early close</Badge>}
                      </div>
                    </Td>
                    <Td className="text-right tabular">{p.activeSubscriptions ?? 0}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                    {canWrite && <Td><Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => setDlg({ open: true, plan: p })}><Pencil /></Button></Td>}
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={Boxes} title="No plans found" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
      <PlanDialog open={dlg.open} onOpenChange={(o) => setDlg({ open: o })} plan={dlg.plan} />
    </>
  );
}
