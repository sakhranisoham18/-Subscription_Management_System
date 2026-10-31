import type { ReactNode } from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import * as T from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className="z-50 min-w-[200px] rounded-lg border border-line bg-white p-1 shadow-lg">
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ onSelect, children, danger, disabled }: { onSelect: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-slate-100 [&_svg]:size-4',
        danger ? 'text-rose-600' : 'text-ink',
      )}
    >
      {children}
    </M.Item>
  );
}
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;

export function Tabs({ tabs, defaultValue }: { tabs: { value: string; label: ReactNode; content: ReactNode }[]; defaultValue?: string }) {
  return (
    <T.Root defaultValue={defaultValue ?? tabs[0]?.value}>
      <T.List className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted hover:text-ink data-[state=active]:border-brand-600 data-[state=active]:text-brand-700"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((t) => (
        <T.Content key={t.value} value={t.value} className="focus:outline-none">
          {t.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
