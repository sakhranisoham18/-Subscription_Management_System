import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { date, methodLabel, money, todayIso } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { CustomerPicker } from '@/components/CustomerPicker';

interface OpenInvoice {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  balanceDue: string;
  displayStatus: string;
}

/**
 * Records a manual payment and allocates it across the customer's open invoices.
 * The server re-validates every allocation (no over-allocation, invoice must be open).
 */
export function PaymentDialog({
  open,
  onOpenChange,
  customerId: presetCustomer,
  invoiceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId?: string;
  invoiceId?: string;
}) {
  const [customerId, setCustomerId] = useState(presetCustomer ?? '');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setCustomerId(presetCustomer ?? '');
      setReference('');
      setNotes('');
      setPaymentDate(todayIso());
      setAlloc({});
    }
  }, [open, presetCustomer]);

  const invoices = useQuery({
    queryKey: ['open-invoices', customerId],
    queryFn: () => api.get<Paged<OpenInvoice>>('/invoices', { customerId, status: 'OPEN', pageSize: 100, sort: 'dueDate', order: 'asc' }),
    enabled: open && Boolean(customerId),
  });

  // Pre-fill the full balance of the invoice the dialog was opened from.
  useEffect(() => {
    if (invoiceId && invoices.data) {
      const inv = invoices.data.data.find((i) => i.id === invoiceId);
      if (inv) setAlloc({ [inv.id]: Number(inv.balanceDue).toFixed(2) });
    }
  }, [invoiceId, invoices.data]);

  const total = useMemo(() => Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0), [alloc]);
  const problems = useMemo(() => {
    const list: string[] = [];
    for (const inv of invoices.data?.data ?? []) {
      const v = Number(alloc[inv.id] || 0);
      if (v < 0) list.push(`${inv.number}: amount cannot be negative`);
      if (v > Number(inv.balanceDue) + 1e-9) list.push(`${inv.number}: exceeds balance ${money(inv.balanceDue)}`);
    }
    return list;
  }, [alloc, invoices.data]);

  const record = useAction(
    () =>
      api.post('/payments', {
        customerId,
        method,
        amount: total.toFixed(2),
        paymentDate,
        reference: reference || null,
        notes: notes || null,
        allocations: Object.entries(alloc)
          .filter(([, v]) => Number(v) > 0)
          .map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount).toFixed(2) })),
      }),
    {
      success: `Payment of ${money(total)} recorded`,
      invalidate: [['payments'], ['invoices'], ['invoice'], ['customer'], ['dashboard'], ['open-invoices']],
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description="Manual payment entry (bank transfer, UPI, card, cash, cheque). No card is charged."
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted">
            Total <span className="font-semibold tabular text-ink">{money(total)}</span>
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => record.mutate()} loading={record.isPending} disabled={!customerId || total <= 0 || problems.length > 0}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" required className="sm:col-span-2">
          {(p) => <CustomerPicker {...p} value={customerId} onChange={(id) => { setCustomerId(id); setAlloc({}); }} disabled={Boolean(presetCustomer)} />}
        </Field>
        <Field label="Method" required>
          {(p) => (
            <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(methodLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Payment date" required>
          {(p) => <Input {...p} type="date" max={todayIso()} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />}
        </Field>
        <Field label="Reference" hint="UTR / transaction / cheque number. Duplicates are rejected.">
          {(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
        <Field label="Note">{(p) => <Textarea {...p} rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-sm font-medium">Allocate to open invoices</p>
        {!customerId ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-muted">Select a customer to see their open invoices.</p>
        ) : invoices.isLoading ? (
          <p className="p-4 text-sm text-muted">Loading invoices…</p>
        ) : !invoices.data?.data.length ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-muted">This customer has no open invoices. Confirm a draft invoice first.</p>
        ) : (
          <div className="rounded-lg border border-line">
            <Table>
              <THead>
                <Tr>
                  <Th>Invoice</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="w-40 text-right">Apply</Th>
                </Tr>
              </THead>
              <TBody>
                {invoices.data.data.map((inv) => (
                  <Tr key={inv.id}>
                    <Td>
                      <p className="font-medium">{inv.number}</p>
                      {inv.displayStatus === 'OVERDUE' && <p className="text-xs text-rose-600">Overdue</p>}
                    </Td>
                    <Td className="text-ink-soft">{date(inv.dueDate)}</Td>
                    <Td className="text-right tabular">{money(inv.balanceDue)}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          aria-label={`Amount for ${inv.number}`}
                          className="h-8 w-28 text-right tabular"
                          value={alloc[inv.id] ?? ''}
                          onChange={(e) => setAlloc((a) => ({ ...a, [inv.id]: e.target.value }))}
                        />
                        <Button variant="ghost" size="sm" onClick={() => setAlloc((a) => ({ ...a, [inv.id]: Number(inv.balanceDue).toFixed(2) }))}>
                          Full
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        {problems.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-rose-600" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
