import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Field, Input } from '@/components/ui/primitives';
import { ErrorState, PageHeader, PageLoader } from '@/components/ui/feedback';
import { ChangePasswordCard } from '../admin/Profile';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  companyName: z.string().optional(),
  phone: z.string().optional(),
  billingContact: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function PortalProfile() {
  const { refreshMe } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['portal-profile'], queryFn: () => api.get<{ data: Values & { email: string } }>('/portal/profile') });
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (data) {
      const { email: _e, ...rest } = data.data as Record<string, unknown>;
      form.reset(Object.fromEntries(Object.entries(rest).filter(([k]) => k in schema.shape).map(([k, v]) => [k, v ?? ''])) as Values);
    }
  }, [data, form]);
  const save = useAction((v: Values) => api.patch('/portal/profile', v), { success: 'Profile updated', invalidate: [['portal-profile']], onSuccess: () => refreshMe() });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const f = (name: keyof Values, label: string, className?: string) => (
    <Field label={label} error={form.formState.errors[name]?.message} className={className}>{(p) => <Input {...p} {...form.register(name)} />}</Field>
  );
  return (
    <>
      <PageHeader title="Profile" description="Billing details used on your invoices." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Billing details" />
          <CardBody>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
              {f('name', 'Contact name')}
              {f('companyName', 'Company')}
              <Field label="Email" hint="Contact Brightloop support to change your email.">{(p) => <Input {...p} value={data.data.email} disabled />}</Field>
              {f('phone', 'Phone')}
              {f('billingContact', 'Billing contact')}
              {f('taxId', 'Tax ID (GSTIN)')}
              {f('addressLine1', 'Address line 1', 'sm:col-span-2')}
              {f('addressLine2', 'Address line 2', 'sm:col-span-2')}
              {f('city', 'City')}
              {f('state', 'State')}
              {f('postalCode', 'Postal code')}
              {f('country', 'Country')}
              <div className="sm:col-span-2"><Button type="submit" loading={save.isPending}>Save changes</Button></div>
            </form>
          </CardBody>
        </Card>
        <ChangePasswordCard />
      </div>
    </>
  );
}
