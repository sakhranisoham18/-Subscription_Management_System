import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import { cn, titleCase } from '@/lib/utils';
import { Badge, Card, Skeleton, type Tone } from './primitives';
import { Button } from './button';

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" role="alert">
      <div className="mb-3 rounded-full bg-rose-50 p-3 text-rose-600">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <p className="font-medium text-ink">We couldn’t load this</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{error instanceof Error ? error.message : 'Unexpected error'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'indigo',
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'indigo' | 'green' | 'amber' | 'red' | 'blue' | 'violet';
  onClick?: () => void;
}) {
  const tones = {
    indigo: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
    blue: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  const Comp = onClick ? 'button' : 'div';
  return (
    <Card className={cn('p-0', onClick && 'transition hover:border-brand-200 hover:shadow-md')}>
      <Comp onClick={onClick} className="flex w-full items-start justify-between gap-3 p-4 text-left">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-1.5 truncate text-2xl font-semibold tabular text-ink">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        {Icon && (
          <div className={cn('rounded-lg p-2', tones[tone])}>
            <Icon className="size-5" aria-hidden />
          </div>
        )}
      </Comp>
    </Card>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  // subscriptions
  DRAFT: 'gray',
  QUOTATION: 'violet',
  CONFIRMED: 'blue',
  ACTIVE: 'green',
  PAUSED: 'amber',
  CLOSED: 'gray',
  // invoices
  PARTIALLY_PAID: 'amber',
  PAID: 'green',
  OVERDUE: 'red',
  CANCELLED: 'gray',
  // quotations
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  EXPIRED: 'gray',
  CONVERTED: 'indigo',
  // misc
  COMPLETED: 'green',
  VOIDED: 'red',
  INACTIVE: 'gray',
  ARCHIVED: 'gray',
  PENDING: 'amber',
  APPROVED: 'green',
  SUCCESS: 'green',
  PARTIAL: 'amber',
  FAILED: 'red',
  RUNNING: 'blue',
  INVOICED: 'green',
  SKIPPED: 'gray',
};

/** Consistent status colours across the whole app. Invoice "Confirmed" reads as "Open". */
export function StatusBadge({ status, kind }: { status: string; kind?: 'invoice' }) {
  const label = kind === 'invoice' && status === 'CONFIRMED' ? 'Open' : titleCase(status);
  return <Badge tone={STATUS_TONES[status] ?? 'gray'}>{label}</Badge>;
}

export function DescriptionList({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ items }: { items: { id: string; title: ReactNode; meta: ReactNode; tone?: 'brand' | 'gray' }[] }) {
  if (!items.length) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span className={cn('absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-white', i.tone === 'gray' ? 'bg-slate-300' : 'bg-brand-500')} />
          <p className="text-sm text-ink">{i.title}</p>
          <p className="text-xs text-muted">{i.meta}</p>
        </li>
      ))}
    </ol>
  );
}
