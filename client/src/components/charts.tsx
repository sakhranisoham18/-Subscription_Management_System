import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, moneyCompact } from '@/lib/format';
import { titleCase } from '@/lib/utils';

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function RevenueChart({ data, height = 280 }: { data: { month: string; invoiced: string; collected: string }[]; height?: number }) {
  const rows = data.map((d) => ({ month: monthLabel(d.month), Invoiced: Number(d.invoiced), Collected: Number(d.collected) }));
  return (
    <div style={{ height }} role="img" aria-label="Revenue by month: invoiced versus collected">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="inv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="col" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef0f5" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => moneyCompact(v)} />
          <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ borderRadius: 10, border: '1px solid #e5e8f0', fontSize: 13 }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="Invoiced" stroke="#6366f1" strokeWidth={2} fill="url(#inv)" />
          <Area type="monotone" dataKey="Collected" stroke="#10b981" strokeWidth={2} fill="url(#col)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#10b981',
  PAUSED: '#f59e0b',
  CONFIRMED: '#0ea5e9',
  QUOTATION: '#8b5cf6',
  DRAFT: '#94a3b8',
  CLOSED: '#cbd5e1',
};

export function StatusDonut({ counts, height = 220 }: { counts: Record<string, number>; height?: number }) {
  const rows = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: titleCase(k), key: k, value: v }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <div style={{ height, width: height }} className="relative shrink-0" role="img" aria-label="Subscriptions by status">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
              {rows.map((r) => (
                <Cell key={r.key} fill={STATUS_COLORS[r.key] ?? '#94a3b8'} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e8f0', fontSize: 13 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular">{total}</span>
          <span className="text-xs text-muted">total</span>
        </div>
      </div>
      <ul className="min-w-[150px] flex-1 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[r.key] ?? '#94a3b8' }} />
            <span className="text-ink-soft">{r.name}</span>
            <span className="ml-auto pl-4 font-medium tabular">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HBarChart({ data, height = 220 }: { data: { label: string; value: number }[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef0f5" horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => moneyCompact(v)} />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={110} tick={{ fontSize: 12, fill: '#3b4668' }} />
          <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ borderRadius: 10, border: '1px solid #e5e8f0', fontSize: 13 }} />
          <Bar dataKey="value" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
