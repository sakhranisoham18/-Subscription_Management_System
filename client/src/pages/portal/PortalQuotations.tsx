import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSignature, FileText } from 'lucide-react';
import { api, errorMessage, openFile } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { DocLine } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { DocLinesTable, Totals } from '@/components/DocLines';

interface Row { id: string; number: string; status: string; quotationDate: string; validUntil: string; total: string }
interface Detail extends Row { subtotal: string; discountTotal: string; taxTotal: string; notes: string | null; terms: string | null; lines: DocLine[]; discount: { code: string } | null }

export default function PortalQuotations() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal-quotations'], queryFn: () => api.get<{ data: Row[] }>('/portal/quotations') });
  const [openId, setOpenId] = useState<string>();
  const [declining, setDeclining] = useState(false);
  const detail = useQuery({ queryKey: ['portal-quotation', openId], queryFn: () => api.get<{ data: Detail }>(`/portal/quotations/${openId}`), enabled: Boolean(openId) });
  const inv = [['portal-quotations'], ['portal-quotation', openId], ['portal-dashboard']];
  const accept = useAction(() => api.post(`/portal/quotations/${openId}/accept`), { success: 'Quotation accepted — we’ll set up your subscription shortly', invalidate: inv });
  const reject = useAction((reason: string) => api.post(`/portal/quotations/${openId}/reject`, { reason }), { success: 'Quotation declined', invalidate: inv, onSuccess: () => setDeclining(false) });
  const q = detail.data?.data;

  return (
    <>
      <PageHeader title="Quotations" description="Offers from Brightloop. Accept one and our team will set up your subscription." />
      <Card>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead><Tr><Th>Quotation</Th><Th>Date</Th><Th>Valid until</Th><Th>Status</Th><Th className="text-right">Total</Th></Tr></THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={5} rows={3} /> : data?.data.map((r) => (
                  <Tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(r.id)}>
                    <Td className="font-medium">{r.number}</Td>
                    <Td>{date(r.quotationDate)}</Td>
                    <Td>{date(r.validUntil)}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-right tabular">{money(r.total)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && !data?.data.length && <EmptyState icon={FileSignature} title="No quotations yet" description="Request one from the plans page." />}
          </>
        )}
      </Card>
      <Dialog
        open={Boolean(openId)}
        onOpenChange={(o) => !o && setOpenId(undefined)}
        title={q ? `Quotation ${q.number}` : 'Loading…'}
        description={q ? `Valid until ${date(q.validUntil)}` : undefined}
        size="xl"
        footer={
          q && (
            <>
              <Button variant="secondary" onClick={() => openFile(`/portal/quotations/${q.id}/pdf`).catch((e) => toast.error(errorMessage(e)))}><FileText /> View PDF</Button>
              {q.status === 'SENT' && <Button variant="danger-ghost" onClick={() => setDeclining(true)}>Decline</Button>}
              {q.status === 'SENT' && <Button loading={accept.isPending} onClick={() => accept.mutate()}>Accept quotation</Button>}
            </>
          )
        }
      >
        {q && (
          <div className="space-y-4">
            <StatusBadge status={q.status} />
            <DocLinesTable lines={q.lines} />
            <Totals subtotal={q.subtotal} discountTotal={q.discountTotal} taxTotal={q.taxTotal} total={q.total} discountLabel={q.discount?.code} />
            {q.terms && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-ink-soft"><strong>Terms:</strong> {q.terms}</p>}
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={declining} onOpenChange={setDeclining} title="Decline this quotation?" description="Let us know why (optional) so we can improve our offer." reasonLabel="Reason" tone="danger" confirmLabel="Decline" loading={reject.isPending} onConfirm={(r) => reject.mutate(r)} />
    </>
  );
}
