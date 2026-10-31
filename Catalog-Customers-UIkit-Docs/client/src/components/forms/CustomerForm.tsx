import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the contact name'),
  companyName: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().optional(),
  billingContact: z.string().trim().optional(),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
  taxId: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
export type CustomerValues = z.infer<typeof customerSchema>;

export function CustomerFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  title,
  hideEmail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Partial<CustomerValues>;
  onSubmit: (v: CustomerValues) => Promise<unknown>;
  title: string;
  hideEmail?: boolean;
}) {
  const form = useForm<CustomerValues>({ resolver: zodResolver(customerSchema), defaultValues: { country: 'India', ...initial } });
  const { register, handleSubmit, formState, reset, setError } = form;
  useEffect(() => {
    if (open) reset({ country: 'India', ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? ''])) });
  }, [open, initial, reset]);

  const submit = handleSubmit(async (v) => {
    try {
      await onSubmit(v);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.fields) for (const [k, m] of Object.entries(e.fields)) setError(k as keyof CustomerValues, { message: m });
    }
  });

  const f = (name: keyof CustomerValues, label: string, opts: { required?: boolean; type?: string; className?: string } = {}) => (
    <Field label={label} required={opts.required} error={formState.errors[name]?.message} className={opts.className}>
      {(p) => <Input {...p} type={opts.type ?? 'text'} {...register(name)} />}
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={formState.isSubmitting}>
            Save customer
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {f('name', 'Contact name', { required: true })}
        {f('companyName', 'Company name')}
        {!hideEmail && f('email', 'Email', { required: true, type: 'email' })}
        {f('phone', 'Phone', { type: 'tel' })}
        {f('billingContact', 'Billing contact')}
        {f('taxId', 'Tax ID (GSTIN)')}
        {f('addressLine1', 'Address line 1', { className: 'sm:col-span-2' })}
        {f('addressLine2', 'Address line 2', { className: 'sm:col-span-2' })}
        {f('city', 'City')}
        {f('state', 'State')}
        {f('postalCode', 'Postal code')}
        {f('country', 'Country')}
        <Field label="Internal notes" className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={2} {...register('notes')} />}
        </Field>
      </form>
    </Dialog>
  );
}
