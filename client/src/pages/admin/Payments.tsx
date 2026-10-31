import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { date, methodLabel, money } from '@/lib/format';
import { useAction, useListState, usePaged } from '@/lib/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, Input } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Pagination, SortableTh, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';
import { PaymentDialog } from '@/components/forms/PaymentDialog';
import { CustomerPicker } from '@/components/CustomerPicker';

interface Row {
  id: string;
  number: string;
  method: string;
  amount: string;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
  status: string;
  voidReason: string | null;
  customer: { id: string; name: string; companyName: string | null };
  allocations: { amount: string; invoice: { id: string; number: string } }[];
  recordedBy: { name: string } | null;
}

export default function Payments() {
  const { can } = useAuth();
  const list = useListState({ sort: 'paymentDate' });
  const { data, isLoading, error, refetch } = usePaged<Row>('payments', '/payments', list.query);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const voidPayment = useAction((reason: string) => api.post(`/payments/${voiding!.id}/void`, { reason }), {
    success: 'Payment voided — invoice balances restored',
    invalidate: [['payments'], ['invoices'], ['invoice'], ['dashboard']],
    onSuccess: () => setVoiding(null),
  });
  const byMethod = (data?.meta.byMethod as { method: string; count: number; amount: string }[] | undefined) ?? [];

  return (
    <>
      <PageHeader
        title="Payments"
        description="Reconcile payments against invoices — filter by date, method, customer, invoice and status."
        actions={can('payments:write') && <Button onClick={() => setRecording(true)}><Plus /> Record payment</Button>}
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search payment, reference, invoice or customer">
          <FilterSelect label="Method" value={list.filters.method} onChange={(v) => list.setFilter('method', v)} options={Object.entries(methodLabel)} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[['COMPLETED', 'Completed'], ['VOIDED', 'Voided']]} />
          <CustomerPicker aria-label="Customer filter" className="w-56" allowClear activeOnly={false} placeholder="Customer: All" value={list.filters.customerId ?? ''} onChange={(id) => list.setFilter('customerId', id || undefined)} />
          <Input type="date" aria-label="From date" className="w-auto" value={list.filters.from ?? ''} onChange={(e) => list.setFilter('from', e.target.value || undefined)} />
          <span className="text-sm text-muted">to</span>
          <Input type="date" aria-label="To date" className="w-auto" value={list.filters.to ?? ''} onChange={(e) => list.setFilter('to', e.target.value || undefined)} />
        </ListToolbar>
        {data && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-muted">
            <span>Collected <strong className="tabular text-ink">{money(data.meta.totalAmount as string)}</strong></span>
            {byMethod.map((m) => (
              <span key={m.method}>{methodLabel[m.method]} <strong className="tabular text-ink">{money(m.amount)}</strong> ({m.count})</span>
            ))}
          </div>
        )}
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Payment" field="number" {...list} />
                  <SortableTh label="Date" field="paymentDate" {...list} />
                  <Th>Customer</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th>Invoices</Th>
                  <Th>Status</Th>
                  <SortableTh label="Amount" field="amount" {...list} className="text-right" />
                  {can('payments:void') && <Th className="w-16" />}
                </Tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={9} /> : data?.data.map((p) => (
                  <Tr key={p.id} className={p.status === 'VOIDED' ? 'bg-slate-50/60 text-muted' : ''}>
                    <Td>
                      <p className="font-medium">{p.number}</p>
                      {p.recordedBy && <p className="text-xs text-muted">by {p.recordedBy.name}</p>}
                    </Td>
                    <Td>{date(p.paymentDate)}</Td>
                    <Td><Link to={`/customers/${p.customer.id}`} className="hover:underline">{p.customer.companyName ?? p.customer.name}</Link></Td>
                    <Td>{methodLabel[p.method]}</Td>
                    <Td className="text-ink-soft">{p.reference ?? '—'}{p.notes && <p className="max-w-[180px] truncate text-xs text-muted" title={p.notes}>{p.notes}</p>}</Td>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        {p.allocations.map((a) => (
                          <Link key={a.invoice.id} to={`/invoices/${a.invoice.id}`} className="text-xs hover:underline">
                            {a.invoice.number} <span className="text-muted">· {money(a.amount)}</span>
                          </Link>
                        ))}
                      </div>
                    </Td>
                    <Td><StatusBadge status={p.status} />{p.voidReason && <p className="mt-1 text-xs">{p.voidReason}</p>}</Td>
                    <Td className="text-right font-medium tabular">{money(p.amount)}</Td>
                    {can('payments:void') && (
                      <Td>{p.status === 'COMPLETED' && <Button variant="danger-ghost" size="sm" onClick={() => setVoiding(p)}>Void</Button>}</Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={CreditCard} title="No payments match these filters" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">Payments are recorded manually. No payment gateway is connected and no cards are charged. Bank-statement import is a planned extension.</p>
      <PaymentDialog open={recording} onOpenChange={setRecording} />
      <ConfirmDialog
        open={Boolean(voiding)}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={`Void payment ${voiding?.number}?`}
        description={<>The {money(voiding?.amount)} allocation is reversed and the invoice balance restored. The payment stays in history as voided.</>}
        reasonLabel="Reason"
        reasonRequired
        tone="danger"
        confirmLabel="Void payment"
        loading={voidPayment.isPending}
        onConfirm={(r) => voidPayment.mutate(r)}
      />
    </>
  );
}
