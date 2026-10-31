import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

const schema = z.object({ email: z.string().trim().email('Enter a valid email') });

export default function ForgotPassword() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ data: { message: string } }>('/auth/forgot-password', values);
      setMessage(res.data.message);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthLayout title="Reset your password" subtitle="We’ll email you a link to choose a new password.">
      {message ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
            <MailCheck className="size-5 shrink-0" />
            <p>{message} The link expires in 30 minutes.</p>
          </div>
          {import.meta.env.DEV && (
            <p className="text-xs text-muted">Development mode: no SMTP is configured, so the email is printed in the server console and shown in Settings → Dev outbox (admin).</p>
          )}
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:underline">
            ← Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          <Field label="Registered email" error={formState.errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm text-muted hover:text-ink">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
