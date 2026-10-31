import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BadgePercent,
  BarChart3,
  Boxes,
  CalendarClock,
  CreditCard,
  FileSignature,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Package,
  Repeat,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? '#312e81' : '#1e1b4b'} />
        <path d="M9 21.5a7 7 0 1 1 7 3.5" fill="none" stroke="#a5b4fc" strokeWidth="3" strokeLinecap="round" />
        <circle cx="16" cy="25" r="2.2" fill="#fbbf24" />
      </svg>
      <div className="leading-tight">
        <p className={cn('text-sm font-semibold', light ? 'text-white' : 'text-ink')}>Brightloop Software</p>
        <p className={cn('text-[11px]', light ? 'text-brand-200' : 'text-muted')}>Subscription Management</p>
      </div>
    </div>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  badge?: number;
}

function SideNav({ items, onNavigate }: { items: { section?: string; items: NavItem[] }[]; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {items.map((group, gi) => (
        <div key={gi}>
          {group.section && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-300/80">{group.section}</p>}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  end={item.to === '/portal'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                      isActive ? 'bg-white/10 text-white' : 'text-brand-100/80 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  <item.icon className="size-4" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-ink">{item.badge}</span> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Shell({ nav, children }: { nav: { section?: string; items: NavItem[] }[]; children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900">
      <div className="flex h-16 items-center px-5">
        <Logo light />
      </div>
      <SideNav items={nav} onNavigate={() => setOpen(false)} />
      <div className="border-t border-white/10 p-4 text-xs text-brand-200/70">
        Signed in as <span className="font-medium text-white">{user?.role === 'CUSTOMER' ? 'Customer' : user?.role === 'ADMIN' ? 'Admin' : 'Staff'}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72">{sidebar}</aside>
          <button className="absolute right-4 top-4 rounded-full bg-white p-2" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
        <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <MenuIcon className="size-5" />
        </button>
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="flex-1" />
        <Menu
          trigger={
            <button className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-100">
              <span className="sr-only">Account menu:</span>
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                {user?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </span>
              <span className="sr-only sm:hidden">{user?.name}</span>
              <span className="hidden text-sm sm:block">
                <span className="block font-medium leading-tight text-ink">{user?.name}</span>
                <span className="block text-xs text-muted">{user?.customer?.companyName ?? user?.email}</span>
              </span>
            </button>
          }
        >
          <MenuItem onSelect={() => navigate(user?.role === 'CUSTOMER' ? '/portal/profile' : '/profile')}>
            <UserCircle /> Profile
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            onSelect={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <LogOut /> Sign out
          </MenuItem>
        </Menu>
      </header>
      <main id="main" className="mx-auto max-w-7xl overflow-x-clip px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

export function AppShell() {
  const { can } = useAuth();
  const requests = useQuery({
    queryKey: ['requests-pending'],
    queryFn: () => api.get<{ meta: { pending: number } }>('/requests', { status: 'PENDING', pageSize: 1 }),
    enabled: can('requests:manage'),
    refetchInterval: 60_000,
  });
  const nav: { section?: string; items: NavItem[] }[] = [
    { items: [{ to: '/overview', label: 'Overview', icon: LayoutDashboard, permission: 'dashboard:view' }] },
    {
      section: 'Sales',
      items: [
        { to: '/customers', label: 'Customers', icon: Users, permission: 'customers:read' },
        { to: '/quotations', label: 'Quotations', icon: FileSignature, permission: 'quotations:read' },
        { to: '/subscriptions', label: 'Subscriptions', icon: Repeat, permission: 'subscriptions:read' },
        { to: '/requests', label: 'Customer requests', icon: Inbox, permission: 'requests:manage', badge: requests.data?.meta.pending },
      ],
    },
    {
      section: 'Billing',
      items: [
        { to: '/billing', label: 'Recurring billing', icon: CalendarClock, permission: 'billing:run' },
        { to: '/invoices', label: 'Invoices', icon: FileText, permission: 'invoices:read' },
        { to: '/payments', label: 'Payments', icon: CreditCard, permission: 'payments:read' },
        { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'reports:view' },
      ],
    },
    {
      section: 'Catalogue',
      items: [
        { to: '/products', label: 'Products', icon: Package, permission: 'products:read' },
        { to: '/plans', label: 'Plans', icon: Boxes, permission: 'plans:read' },
        { to: '/discounts', label: 'Discounts & taxes', icon: BadgePercent, permission: 'discounts:read' },
        { to: '/templates', label: 'Quotation templates', icon: FileSignature, permission: 'templates:read' },
      ],
    },
    {
      section: 'Admin',
      items: [
        { to: '/staff', label: 'Staff', icon: ShieldCheck, permission: 'users:manage' },
        { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings:manage' },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) }))
    .filter((g) => g.items.length);
  return (
    <Shell nav={nav}>
      <Outlet />
    </Shell>
  );
}

export function PortalShell() {
  const nav = [
    {
      items: [
        { to: '/portal', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/portal/subscriptions', label: 'My subscriptions', icon: Repeat },
        { to: '/portal/invoices', label: 'Invoices', icon: FileText },
        { to: '/portal/payments', label: 'Payment history', icon: CreditCard },
        { to: '/portal/quotations', label: 'Quotations', icon: FileSignature },
        { to: '/portal/plans', label: 'Browse plans', icon: Boxes },
        { to: '/portal/profile', label: 'Profile', icon: UserCircle },
      ],
    },
  ];
  return (
    <Shell nav={nav}>
      <Outlet />
    </Shell>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm text-muted hover:text-ink">
      ← {children}
    </Link>
  );
}
