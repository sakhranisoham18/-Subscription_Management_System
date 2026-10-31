import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Archive, ArchiveRestore, MoreHorizontal, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useAction, useListState, useOptions, usePaged } from '@/lib/hooks';
import type { Product, TaxRule, Variant } from '@/lib/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem } from '@/components/ui/menu';
import { Pagination, SortableTh, Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { FilterSelect, ListToolbar } from '@/components/ListToolbar';

const amount = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter a non-negative amount');
const signed = z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, 'Enter an amount (can be negative)');
const productSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name'),
  productType: z.string().trim().min(2, 'Enter a type'),
  salesPrice: amount,
  costPrice: amount,
  description: z.string().optional(),
  taxRuleId: z.string().optional(),
  variants: z.array(z.object({ attribute: z.string().trim().min(1, 'Required'), name: z.string().trim().min(1, 'Required'), priceAdjustment: signed })),
});
type ProductValues = z.infer<typeof productSchema>;

function ProductDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product }) {
  const taxes = useOptions<TaxRule>('taxes', '/taxes', { status: 'ACTIVE' });
  const form = useForm<ProductValues>({ resolver: zodResolver(productSchema) });
  const variants = useFieldArray({ control: form.control, name: 'variants' });
  useEffect(() => {
    if (open)
      form.reset(
        product
          ? { name: product.name, productType: product.productType, salesPrice: Number(product.salesPrice).toFixed(2), costPrice: Number(product.costPrice).toFixed(2), description: product.description ?? '', taxRuleId: product.taxRuleId ?? '', variants: [] }
          : { name: '', productType: 'Software', salesPrice: '', costPrice: '', description: '', taxRuleId: '', variants: [] },
      );
  }, [open, product, form]);
  const save = useAction(
    (v: ProductValues) => {
      const body = { ...v, taxRuleId: v.taxRuleId || null, description: v.description || null };
      return product ? api.patch(`/products/${product.id}`, { ...body, variants: undefined }) : api.post('/products', body);
    },
    { success: product ? 'Product updated' : 'Product created', invalidate: [['products'], ['options']], onSuccess: () => onOpenChange(false) },
  );
  const base = Number(form.watch('salesPrice') || 0);
  const e = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={product ? `Edit ${product.name}` : 'New product'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>Save product</Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Product name" required error={e.name?.message}>{(p) => <Input {...p} {...form.register('name')} />}</Field>
        <Field label="Product type" required error={e.productType?.message} hint="e.g. Software, Add-on, Service">{(p) => <Input {...p} list="product-types" {...form.register('productType')} />}</Field>
        <datalist id="product-types"><option value="Software" /><option value="Add-on" /><option value="Service" /></datalist>
        <Field label="Sales price (₹)" required error={e.salesPrice?.message}>{(p) => <Input {...p} inputMode="decimal" {...form.register('salesPrice')} />}</Field>
        <Field label="Cost price (₹)" required error={e.costPrice?.message}>{(p) => <Input {...p} inputMode="decimal" {...form.register('costPrice')} />}</Field>
        <Field label="Default tax rule" className="sm:col-span-2" hint="Used on quotation, subscription and invoice lines unless overridden.">
          {(p) => (
            <Select {...p} {...form.register('taxRuleId')}>
              <option value="">Use the default tax rule</option>
              {taxes.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Notes / description" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...form.register('description')} />}</Field>
        {!product && (
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Variants</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => variants.append({ attribute: 'Brand', name: '', priceAdjustment: '0' })}><Plus /> Add variant</Button>
            </div>
            {variants.fields.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-muted">Optional. For example Brand: Odoo with a +560 price adjustment.</p>}
            <div className="space-y-2">
              {variants.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_1fr_120px_auto_auto] items-end gap-2">
                  <Field label="Attribute" error={e.variants?.[i]?.attribute?.message}>{(p) => <Input {...p} {...form.register(`variants.${i}.attribute`)} />}</Field>
                  <Field label="Value" error={e.variants?.[i]?.name?.message}>{(p) => <Input {...p} {...form.register(`variants.${i}.name`)} />}</Field>
                  <Field label="Adjustment" error={e.variants?.[i]?.priceAdjustment?.message}>{(p) => <Input {...p} inputMode="decimal" {...form.register(`variants.${i}.priceAdjustment`)} />}</Field>
                  <p className="pb-2 text-xs text-muted tabular">= {money(base + Number(form.watch(`variants.${i}.priceAdjustment`) || 0))}</p>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove variant" onClick={() => variants.remove(i)}><Trash2 /></Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

function VariantDialog({ open, onOpenChange, product, variant }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product; variant?: Variant }) {
  const schema = z.object({ attribute: z.string().trim().min(1, 'Required'), name: z.string().trim().min(1, 'Required'), priceAdjustment: signed });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (open) form.reset(variant ? { attribute: variant.attribute, name: variant.name, priceAdjustment: Number(variant.priceAdjustment).toFixed(2) } : { attribute: product?.variants[0]?.attribute ?? 'Brand', name: '', priceAdjustment: '0' });
  }, [open, variant, product, form]);
  const save = useAction(
    (v: z.infer<typeof schema>) => (variant ? api.patch(`/products/${product!.id}/variants/${variant.id}`, v) : api.post(`/products/${product!.id}/variants`, v)),
    { success: 'Variant saved', invalidate: [['products'], ['options']], onSuccess: () => onOpenChange(false) },
  );
  const final = Number(product?.salesPrice ?? 0) + Number(form.watch('priceAdjustment') || 0);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={variant ? 'Edit variant' : `Add variant to ${product?.name}`}
      size="sm"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>Save</Button></>}
    >
      <div className="space-y-4">
        <Field label="Attribute" error={form.formState.errors.attribute?.message}>{(p) => <Input {...p} {...form.register('attribute')} />}</Field>
        <Field label="Value" error={form.formState.errors.name?.message}>{(p) => <Input {...p} {...form.register('name')} />}</Field>
        <Field label="Price adjustment (₹)" error={form.formState.errors.priceAdjustment?.message} hint={`Final price ${money(final)} (base ${money(product?.salesPrice)})`}>
          {(p) => <Input {...p} inputMode="decimal" {...form.register('priceAdjustment')} />}
        </Field>
      </div>
    </Dialog>
  );
}

export default function Products() {
  const { can } = useAuth();
  const canWrite = can('products:write');
  const list = useListState({ sort: 'createdAt' });
  const { data, isLoading, error, refetch } = usePaged<Product>('products', '/products', list.query);
  const [editing, setEditing] = useState<{ open: boolean; product?: Product }>({ open: false });
  const [variantDlg, setVariantDlg] = useState<{ open: boolean; product?: Product; variant?: Variant }>({ open: false });
  const setStatus = useAction(({ id, status }: { id: string; status: string }) => api.patch(`/products/${id}`, { status }), { success: 'Product updated', invalidate: [['products'], ['options']] });
  const types = (data?.meta.productTypes as string[] | undefined) ?? [];

  return (
    <>
      <PageHeader
        title="Products"
        description={canWrite ? 'Products, prices and variants offered on subscriptions.' : 'Product catalogue (read-only — only the admin can change products).'}
        actions={canWrite && <Button onClick={() => setEditing({ open: true })}><Plus /> New product</Button>}
      />
      <Card>
        <ListToolbar search={list.search} onSearch={list.setSearch} placeholder="Search products">
          <FilterSelect label="Type" value={list.filters.productType} onChange={(v) => list.setFilter('productType', v)} options={types.map((t) => [t, t])} />
          <FilterSelect label="Status" value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={[['ACTIVE', 'Active'], ['ARCHIVED', 'Archived']]} />
        </ListToolbar>
        {error ? <ErrorState error={error} onRetry={refetch} /> : (
          <>
            <Table>
              <THead>
                <Tr>
                  <SortableTh label="Product" field="name" {...list} />
                  <SortableTh label="Type" field="productType" {...list} />
                  <SortableTh label="Sales price" field="salesPrice" {...list} className="text-right" />
                  <Th className="text-right">Cost</Th>
                  <Th>Variants (final price)</Th>
                  <Th>Tax</Th>
                  <Th>Status</Th>
                  {canWrite && <Th className="w-10"><span className="sr-only">Actions</span></Th>}
                </Tr>
              </THead>
              <TBody>
                {isLoading ? <TableSkeleton cols={8} /> : data?.data.map((p) => (
                  <Tr key={p.id} className="hover:bg-slate-50/60">
                    <Td>
                      <p className="font-medium">{p.name}</p>
                      {p.description && <p className="max-w-xs truncate text-xs text-muted">{p.description}</p>}
                    </Td>
                    <Td className="text-ink-soft">{p.productType}</Td>
                    <Td className="text-right tabular">{money(p.salesPrice)}</Td>
                    <Td className="text-right tabular text-muted">{money(p.costPrice)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {p.variants.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            disabled={!canWrite}
                            onClick={() => setVariantDlg({ open: true, product: p, variant: v })}
                            className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-brand-300 disabled:cursor-default disabled:hover:border-line"
                            title={`${v.attribute}: ${v.name} (${Number(v.priceAdjustment) >= 0 ? '+' : ''}${v.priceAdjustment})`}
                          >
                            <span className={v.status === 'ARCHIVED' ? 'line-through' : ''}>{v.name}</span>{' '}
                            <span className="text-muted">{Number(v.priceAdjustment) !== 0 ? `${Number(v.priceAdjustment) > 0 ? '+' : ''}${Number(v.priceAdjustment)}` : ''} · {money(v.finalPrice)}</span>
                          </button>
                        ))}
                        {canWrite && p.status === 'ACTIVE' && (
                          <button type="button" className="rounded-md border border-dashed border-line px-2 py-0.5 text-xs text-muted hover:text-brand-600" onClick={() => setVariantDlg({ open: true, product: p })}>
                            + Variant
                          </button>
                        )}
                        {!p.variants.length && !canWrite && <span className="text-xs text-muted">—</span>}
                      </div>
                    </Td>
                    <Td className="text-ink-soft">{p.taxRule ? <Badge>{p.taxRule.name}</Badge> : <span className="text-xs text-muted">Default</span>}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                    {canWrite && (
                      <Td>
                        <Menu trigger={<Button variant="ghost" size="icon" aria-label={`Actions for ${p.name}`}><MoreHorizontal /></Button>}>
                          <MenuItem onSelect={() => setEditing({ open: true, product: p })}><Pencil /> Edit</MenuItem>
                          {p.status === 'ACTIVE' ? (
                            <MenuItem onSelect={() => setStatus.mutate({ id: p.id, status: 'ARCHIVED' })}><Archive /> Archive (keeps history)</MenuItem>
                          ) : (
                            <MenuItem onSelect={() => setStatus.mutate({ id: p.id, status: 'ACTIVE' })}><ArchiveRestore /> Restore</MenuItem>
                          )}
                        </Menu>
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
            {!isLoading && data?.data.length === 0 && <EmptyState icon={Package} title="No products found" />}
            {data && <Pagination {...data.meta} onPage={list.setPage} />}
          </>
        )}
      </Card>
      <ProductDialog open={editing.open} onOpenChange={(o) => setEditing({ open: o })} product={editing.product} />
      <VariantDialog open={variantDlg.open} onOpenChange={(o) => setVariantDlg({ open: o })} product={variantDlg.product} variant={variantDlg.variant} />
    </>
  );
}
