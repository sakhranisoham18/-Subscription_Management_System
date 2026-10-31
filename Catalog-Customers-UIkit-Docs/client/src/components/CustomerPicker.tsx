import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { api, type Paged } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { CustomerRow } from '@/lib/types';

const label = (c: { name: string; companyName: string | null }) => (c.companyName ? `${c.companyName} — ${c.name}` : c.name);

/**
 * Searchable customer selector (server-side search, 15 results) so it works with thousands of customers.
 * Accessible combobox: arrow keys / Enter / Escape, aria-expanded/activedescendant, labelled option list.
 */
export function CustomerPicker({
  value,
  onChange,
  disabled,
  allowClear,
  placeholder = 'Search customers…',
  activeOnly = true,
  className,
  ...aria
}: {
  value: string;
  onChange: (id: string, customer?: CustomerRow) => void;
  disabled?: boolean;
  /** Show a clear button (for optional filters). */
  allowClear?: boolean;
  placeholder?: string;
  activeOnly?: boolean;
  className?: string;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [chosenLabel, setChosenLabel] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(text.trim(), 250);

  // Resolve the label of a preselected id (from the URL or when editing).
  const current = useQuery({
    queryKey: ['customer-label', value],
    queryFn: () => api.get<{ data: CustomerRow }>(`/customers/${value}`),
    enabled: Boolean(value) && !chosenLabel,
    staleTime: 5 * 60_000,
  });
  const shownLabel = value ? chosenLabel || (current.data ? label(current.data.data) : '') : '';

  const results = useQuery({
    queryKey: ['customer-picker', debounced, activeOnly],
    queryFn: () => api.get<Paged<CustomerRow>>('/customers', { search: debounced || undefined, status: activeOnly ? 'ACTIVE' : undefined, pageSize: 15, sort: 'name', order: 'asc' }),
    enabled: open,
    staleTime: 15_000,
  });
  const items = results.data?.data ?? [];

  useEffect(() => setCursor(0), [debounced, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (c: CustomerRow) => {
    setChosenLabel(label(c));
    setText('');
    setOpen(false);
    onChange(c.id, c);
  };
  const clear = () => {
    setChosenLabel('');
    setText('');
    onChange('');
  };

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          {...aria}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[cursor] ? `${listId}-${items[cursor].id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open || !value ? text : shownLabel}
          placeholder={value ? shownLabel || 'Loading…' : placeholder}
          onFocus={() => !disabled && setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setCursor((c) => Math.min(c + 1, Math.max(items.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter' && open && items[cursor]) {
              e.preventDefault();
              choose(items[cursor]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className={cn(
            'h-9 w-full rounded-lg border border-line bg-white px-3 pr-16 text-sm text-ink shadow-sm transition placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-muted aria-[invalid=true]:border-rose-400',
            value && !open && 'font-medium',
          )}
        />
        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-slate-400">
          {results.isFetching && open ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          <ChevronsUpDown className="size-4" aria-hidden />
        </div>
        {allowClear && value && !disabled && (
          <button type="button" aria-label="Clear customer" onClick={clear} className="absolute inset-y-0 right-7 flex items-center px-1 text-slate-400 hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label="Customers" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-white p-1 shadow-lg">
          {results.isLoading && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {!results.isLoading && items.length === 0 && <li className="px-3 py-2 text-sm text-muted">No customers match “{debounced}”.</li>}
          {items.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={c.id === value}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              className={cn('flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm', i === cursor ? 'bg-brand-50 text-brand-800' : 'text-ink')}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.companyName ?? c.name}</span>
                <span className="block truncate text-xs text-muted">
                  {c.companyName ? `${c.name} · ` : ''}
                  {c.email}
                </span>
              </span>
              {c.id === value && <Check className="size-4 shrink-0 text-brand-600" aria-hidden />}
            </li>
          ))}
          {results.data && results.data.meta.total > items.length && <li className="px-3 py-1.5 text-xs text-muted">Showing {items.length} of {results.data.meta.total} — keep typing to narrow down.</li>}
        </ul>
      )}
    </div>
  );
}
