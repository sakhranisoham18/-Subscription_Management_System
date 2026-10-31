import type { ReactNode } from 'react';
import { CalendarClock, CreditCard, LineChart, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/layout/AppShell';
import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(9, 'Must be more than 8 characters')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/[^A-Za-z0-9]/, 'Add a special character');

export function PasswordRules({ value }: { value: string }) {
  const rules = [
    ['More than 8 characters', value.length > 8],
    ['An uppercase letter', /[A-Z]/.test(value)],
    ['A lowercase letter', /[a-z]/.test(value)],
    ['A special character', /[^A-Za-z0-9]/.test(value)],
  ] as const;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" aria-label="Password requirements">
      {rules.map(([label, ok]) => (
        <li key={label} className={ok ? 'text-emerald-600' : 'text-muted'}>
          {ok ? '✓' : '•'} {label}
        </li>
      ))}
    </ul>
  );
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside aria-label="About Brightloop" className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col">
        <Logo light />
        <div className="my-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">One platform. Every subscription. Automated billing.</h2>
          <p className="mt-4 text-brand-100/80">Plans, quotations, subscriptions, recurring invoices, payments and revenue reporting — in one place.</p>
          <ul className="mt-10 space-y-4 text-sm">
            {[
              [CalendarClock, 'Recurring invoices generated on billing day — never twice, never skipped'],
              [CreditCard, 'Payments matched to invoices with live outstanding balances'],
              [LineChart, 'Recurring revenue, collections and overdue in one view'],
              [ShieldCheck, 'Role-based access with a secure customer portal'],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof CalendarClock;
              return (
                <li key={i} className="flex items-start gap-3">
                  <span className="rounded-lg bg-white/10 p-2">
                    <I className="size-4 text-brand-200" />
                  </span>
                  <span className="pt-1 text-brand-100">{text as string}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-xs text-brand-200/60">© {new Date().getFullYear()} Brightloop Software</p>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full border-[40px] border-white/5" aria-hidden />
      </aside>
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
