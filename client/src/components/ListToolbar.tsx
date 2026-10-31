import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input, Select } from '@/components/ui/primitives';

export function ListToolbar({ search, onSearch, placeholder = 'Search…', children }: { search: string; onSearch: (v: string) => void; placeholder?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
      <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} className="pl-9" aria-label="Search" />
      </div>
      {children}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: [string, string][];
  allLabel?: string;
}) {
  return (
    <Select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="w-auto min-w-[150px]">
      <option value="">
        {label}: {allLabel}
      </option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
}
