import { useEffect, useRef, useState, type ReactNode, type ThHTMLAttributes, type TdHTMLAttributes, type HTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './primitives';

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  // A horizontally scrolling region must be reachable by keyboard; only add the tab stop when it really overflows.
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} tabIndex={scrolls ? 0 : undefined} className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export const THead = ({ children }: { children: ReactNode }) => <thead className="bg-slate-50/80 text-left">{children}</thead>;
export const TBody = ({ children }: { children: ReactNode }) => <tbody className="divide-y divide-line">{children}</tbody>;
export const Tr = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('transition-colors', className)} {...p} />;
export const Th = ({ className, children, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('whitespace-nowrap border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted', className)} {...p}>
    {children ?? <span className="sr-only">Actions</span>}
  </th>
);
export const Td = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-4 py-3 align-middle text-ink', className)} {...p} />;

export function SortableTh({
  label,
  field,
  sort,
  order,
  onSort,
  className,
}: {
  label: string;
  field: string;
  sort?: string;
  order?: 'asc' | 'desc';
  onSort: (field: string) => void;
  className?: string;
}) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Th className={className} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 uppercase hover:text-ink">
        {label}
        <Icon className={cn('size-3', active ? 'text-brand-600' : 'opacity-50')} />
      </button>
    </Th>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <Tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <Td key={c}>
              <Skeleton className="h-4 w-full max-w-[160px]" />
            </Td>
          ))}
        </Tr>
      ))}
    </>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span className="tabular">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden /> Previous
        </Button>
        <span className="px-2 tabular">
          {page} / {totalPages}
        </span>
        <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
