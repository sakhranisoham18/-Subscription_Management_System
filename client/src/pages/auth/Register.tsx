import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { ApiError, errorMessage } from '@/lib/api';
import { AuthLayout, PasswordRules, passwordSchema } from './AuthLayout';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name'),
    companyName: z.string().trim().optional(),
    email: z.string().trim().email('Enter a valid email'),
    phone: z.string().trim().optional(),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function Register() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setError: setFieldError, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ confirm: _c, ...values }) => {
    setError(null);
    try {
      await signUp({ ...values, companyName: values.companyName || undefined, phone: values.phone || undefined });
      toast.success('Welcome to Brightloop! Your account is ready.');
      navigate('/portal', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        for (const [k, v] of Object.entries(e.fields)) setFieldError(k as keyof z.infer<typeof schema>, { message: v });
      }
      setError(errorMessage(e));
    }
  });

  return (
    <AuthLayout title="Create your account" subtitle="Manage your Brightloop subscriptions and invoices online.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        <Field label="Your name" required error={formState.errors.name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...register('name')} />}
        </Field>
        <Field label="Company (optional)">{(p) => <Input {...p} autoComplete="organization" {...register('companyName')} />}</Field>
        <Field label="Email" required error={formState.errors.email?.message} hint="Each email can belong to only one account.">
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Phone (optional)">{(p) => <Input {...p} type="tel" autoComplete="tel" {...register('phone')} />}</Field>
        <Field label="Password" required error={formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}
        </Field>
        <PasswordRules value={watch('password') ?? ''} />
        <Field label="Confirm password" required error={formState.errors.confirm?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
