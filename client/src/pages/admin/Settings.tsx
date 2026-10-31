import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { api, type Paged } from '@/lib/api';
import { dateTime, setLocaleSettings } from '@/lib/format';
import { useAction, useListState, usePaged } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Tabs } from '@/components/ui/menu';
import { Pagination, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { ListToolbar } from '@/components/ListToolbar';

interface SettingsData {
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyTaxId: string;
  currency: string;
  timezone: string;
  invoiceDueDays: number;
  autoConfirmRecurringInvoices: boolean;
  quotationValidityDays: number;
  emailMode: 'smtp' | 'dev';
  scheduler: { enabled: boolean; cron: string };
}

function General() {
  const { data, isLoading, error } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ data: SettingsData }>('/settings') });
  const [form, setForm] = useState<SettingsData | null>(null);
  useEffect(() => { if (data) setForm(data.data); }, [data]);
  const save = useAction(
    () => {
      const { emailMode: _e, scheduler: _s, ...body } = form!;
      return api.patch<{ data: SettingsData }>('/settings', body);
    },
    { success: 'Settings saved', invalidate: [['settings']], onSuccess: (r) => setLocaleSettings(r.data.currency, r.data.timezone) },
  );
  if (isLoading || !form) return <PageLoader />;
  if (error) return <ErrorState error={error} />;
  const set = <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => setForm({ ...form, [k]: v });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Company" description="Shown on invoices, quotations and emails." />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Company name">{(p) => <Input {...p} value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />}</Field>
          <Field label="Billing email">{(p) => <Input {...p} type="email" value={form.companyEmail} onChange={(e) => set('companyEmail', e.target.value)} />}</Field>
          <Field label="Address" className="md:col-span-2">{(p) => <Textarea {...p} rows={2} value={form.companyAddress} onChange={(e) => set('companyAddress', e.target.value)} />}</Field>
          <Field label="GSTIN / tax ID">{(p) => <Input {...p} value={form.companyTaxId} onChange={(e) => set('companyTaxId', e.target.value)} />}</Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Billing defaults" />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Currency (ISO code)" hint="Default currency for new plans and documents">{(p) => <Input {...p} maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />}</Field>
          <Field label="Business timezone" hint="Decides what “today” means for billing and overdue">{(p) => <Input {...p} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} />}</Field>
          <Field label="Default payment terms (days)">{(p) => <Input {...p} type="number" min={0} value={form.invoiceDueDays} onChange={(e) => set('invoiceDueDays', Number(e.target.value))} />}</Field>
          <Field label="Default quotation validity (days)">{(p) => <Input {...p} type="number" min={1} value={form.quotationValidityDays} onChange={(e) => set('quotationValidityDays', Number(e.target.value))} />}</Field>
          <Checkbox className="md:col-span-2" label="Confirm recurring invoices automatically" description="Off: billing runs create drafts for review. On: invoices are confirmed and emailed to the customer straight away." checked={form.autoConfirmRecurringInvoices} onChange={(e) => set('autoConfirmRecurringInvoices', e.target.checked)} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="System" />
        <CardBody className="flex flex-wrap gap-6 text-sm">
          <p>Email delivery: <Badge tone={form.emailMode === 'smtp' ? 'green' : 'amber'}>{form.emailMode === 'smtp' ? 'SMTP' : 'Development mode (logged to outbox)'}</Badge></p>
          <p>Billing scheduler: <Badge tone={form.scheduler.enabled ? 'green' : 'gray'}>{form.scheduler.enabled ? `On · ${form.scheduler.cron}` : 'Off'}</Badge></p>
        </CardBody>
      </Card>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button></div>
    </div>
  );
}

function PermissionMatrix() {
  const { data, isLoading } = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<{ data: Record<string, string[]> }>('/settings/permissions') });
  if (isLoading || !data) return <PageLoader />;
  const roles = ['ADMIN', 'STAFF', 'CUSTOMER'];
  return (
    <Card>
      <CardHeader title="Permission matrix" description="Enforced on every API endpoint. Customers additionally only ever see their own records." />
      <Table>
        <THead><Tr><Th>Permission</Th>{roles.map((r) => <Th key={r} className="text-center">{titleCase(r)}</Th>)}</Tr></THead>
        <TBody>
          {Object.entries(data.data).map(([perm, allowed]) => (
            <Tr key={perm}>
              <Td className="font-mono text-xs">{perm}</Td>
              {roles.map((r) => (
                <Td key={r} className="text-center">{allowed.includes(r) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Allowed" /> : <Minus className="mx-auto size-4 text-slate-300" aria-label="Not allowed" />}</Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

interface Mail { id: string; to: string; subject: string; body: string; status: string; createdAt: string }
function Outbox() {
  const list = useListState();
  const { data, isLoading, error } = usePaged<Mail>('outbox', '/settings/outbox', list.query);
  const [open, setOpen] = useState<Mail | null>(null);
  return (
    <Card>
      <CardHeader title="Email outbox" description="Every email the system sends. In development mode (no SMTP) messages are only stored here — use it to open password-reset links during a demo." />
      <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search recipient or subject" />
      {error ? <ErrorState error={error} /> : (
        <>
          <Table>
            <THead><Tr><Th>When</Th><Th>To</Th><Th>Subject</Th><Th>Status</Th></Tr></THead>
            <TBody>
              {isLoading ? <TableSkeleton cols={4} /> : data?.data.map((m) => (
                <Tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(m)}>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(m.createdAt)}</Td>
                  <Td>{m.to}</Td>
                  <Td className="font-medium">{m.subject}</Td>
                  <Td><Badge tone={m.status === 'FAILED' ? 'red' : m.status === 'SENT' ? 'green' : 'amber'}>{titleCase(m.status)}</Badge></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {!isLoading && !data?.data.length && <EmptyState title="No emails yet" />}
          {data && <Pagination {...data.meta} onPage={list.setPage} />}
        </>
      )}
      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)} title={open?.subject ?? ''} description={`To ${open?.to}`} size="lg">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink">
          {open?.body.split(/(https?:\/\/\S+)/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} className="text-brand-600 underline" target="_blank" rel="noreferrer">{part}</a> : part))}
        </pre>
      </Dialog>
    </Card>
  );
}

interface AuditRow { id: string; action: string; entityType: string; entityId: string | null; details: unknown; createdAt: string; actor: { name: string; role: string } | null }
function Audit() {
  const list = useListState();
  const { data, isLoading, error } = usePaged<AuditRow>('audit', '/settings/audit', { ...list.query, action: list.query.search, search: undefined });
  return (
    <Card>
      <CardHeader title="Audit log" description="Who did what, and when — financial and lifecycle actions." />
      <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Filter by action, e.g. PAYMENT" />
      {error ? <ErrorState error={error} /> : (
        <>
          <Table>
            <THead><Tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Details</Th></Tr></THead>
            <TBody>
              {isLoading ? <TableSkeleton cols={5} /> : (data as Paged<AuditRow> | undefined)?.data.map((a) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(a.createdAt)}</Td>
                  <Td>{a.actor ? `${a.actor.name}` : 'System'}{a.actor && <span className="text-xs text-muted"> · {titleCase(a.actor.role)}</span>}</Td>
                  <Td><span className="font-mono text-xs">{a.action}</span></Td>
                  <Td className="text-ink-soft">{a.entityType}</Td>
                  <Td className="max-w-xs truncate font-mono text-xs text-muted" title={a.details ? JSON.stringify(a.details) : ''}>{a.details ? JSON.stringify(a.details) : '—'}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          {data && <Pagination {...data.meta} onPage={list.setPage} />}
        </>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Company details, billing defaults, permissions, email outbox and audit log." />
      <Tabs
        tabs={[
          { value: 'general', label: 'General', content: <General /> },
          { value: 'permissions', label: 'Permissions', content: <PermissionMatrix /> },
          { value: 'outbox', label: 'Dev outbox', content: <Outbox /> },
          { value: 'audit', label: 'Audit log', content: <Audit /> },
        ]}
      />
    </>
  );
}
