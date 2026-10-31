import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { homeFor, useAuth } from './auth/AuthProvider';
import { AppShell, PortalShell } from './components/layout/AppShell';
import { PageLoader, EmptyState } from './components/ui/feedback';
import { Button } from './components/ui/button';
import { ShieldAlert } from 'lucide-react';

const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));

const Overview = lazy(() => import('./pages/admin/Overview'));
const Customers = lazy(() => import('./pages/admin/Customers'));
const CustomerDetail = lazy(() => import('./pages/admin/CustomerDetail'));
const Products = lazy(() => import('./pages/admin/Products'));
const Plans = lazy(() => import('./pages/admin/Plans'));
const Discounts = lazy(() => import('./pages/admin/Discounts'));
const Templates = lazy(() => import('./pages/admin/Templates'));
const Quotations = lazy(() => import('./pages/admin/Quotations'));
const QuotationEditor = lazy(() => import('./pages/admin/QuotationEditor'));
const QuotationDetail = lazy(() => import('./pages/admin/QuotationDetail'));
const Subscriptions = lazy(() => import('./pages/admin/Subscriptions'));
const SubscriptionEditor = lazy(() => import('./pages/admin/SubscriptionEditor'));
const SubscriptionDetail = lazy(() => import('./pages/admin/SubscriptionDetail'));
const Requests = lazy(() => import('./pages/admin/Requests'));
const Billing = lazy(() => import('./pages/admin/Billing'));
const Invoices = lazy(() => import('./pages/admin/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/admin/InvoiceDetail'));
const InvoiceCreate = lazy(() => import('./pages/admin/InvoiceCreate'));
const Payments = lazy(() => import('./pages/admin/Payments'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Staff = lazy(() => import('./pages/admin/Staff'));
const SettingsPage = lazy(() => import('./pages/admin/Settings'));
const Profile = lazy(() => import('./pages/admin/Profile'));

const PortalDashboard = lazy(() => import('./pages/portal/PortalDashboard'));
const PortalSubscriptions = lazy(() => import('./pages/portal/PortalSubscriptions'));
const PortalSubscriptionDetail = lazy(() => import('./pages/portal/PortalSubscriptionDetail'));
const PortalInvoices = lazy(() => import('./pages/portal/PortalInvoices'));
const PortalInvoiceDetail = lazy(() => import('./pages/portal/PortalInvoiceDetail'));
const PortalPayments = lazy(() => import('./pages/portal/PortalPayments'));
const PortalQuotations = lazy(() => import('./pages/portal/PortalQuotations'));
const PortalPlans = lazy(() => import('./pages/portal/PortalPlans'));
const PortalProfile = lazy(() => import('./pages/portal/PortalProfile'));

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-label="Loading" />
    </div>
  );
}

function RequireAuth({ role, children }: { role: 'internal' | 'customer'; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (role === 'customer' && user.role !== 'CUSTOMER') return <Navigate to="/overview" replace />;
  if (role === 'internal' && user.role === 'CUSTOMER') return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

/** Client-side route guard (the server enforces the same permission on every endpoint). */
function Allow({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="You don’t have access to this page"
        description="Your role does not include this permission. Ask an administrator if you need access."
        action={
          <Button variant="secondary" onClick={() => history.back()}>
            Go back
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

const P = (permission: string, el: ReactNode) => <Allow permission={permission}>{el}</Allow>;

export function App() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<RequireAuth role="internal"><Suspense fallback={<PageLoader />}><AppShell /></Suspense></RequireAuth>}>
          <Route path="/overview" element={P('dashboard:view', <Overview />)} />
          <Route path="/customers" element={P('customers:read', <Customers />)} />
          <Route path="/customers/:id" element={P('customers:read', <CustomerDetail />)} />
          <Route path="/products" element={P('products:read', <Products />)} />
          <Route path="/plans" element={P('plans:read', <Plans />)} />
          <Route path="/discounts" element={P('discounts:read', <Discounts />)} />
          <Route path="/templates" element={P('templates:read', <Templates />)} />
          <Route path="/quotations" element={P('quotations:read', <Quotations />)} />
          <Route path="/quotations/new" element={P('quotations:write', <QuotationEditor />)} />
          <Route path="/quotations/:id" element={P('quotations:read', <QuotationDetail />)} />
          <Route path="/quotations/:id/edit" element={P('quotations:write', <QuotationEditor />)} />
          <Route path="/subscriptions" element={P('subscriptions:read', <Subscriptions />)} />
          <Route path="/subscriptions/new" element={P('subscriptions:write', <SubscriptionEditor />)} />
          <Route path="/subscriptions/:id" element={P('subscriptions:read', <SubscriptionDetail />)} />
          <Route path="/subscriptions/:id/edit" element={P('subscriptions:write', <SubscriptionEditor />)} />
          <Route path="/requests" element={P('requests:manage', <Requests />)} />
          <Route path="/billing" element={P('billing:run', <Billing />)} />
          <Route path="/invoices" element={P('invoices:read', <Invoices />)} />
          <Route path="/invoices/new" element={P('invoices:write', <InvoiceCreate />)} />
          <Route path="/invoices/:id" element={P('invoices:read', <InvoiceDetail />)} />
          <Route path="/payments" element={P('payments:read', <Payments />)} />
          <Route path="/reports" element={P('reports:view', <Reports />)} />
          <Route path="/staff" element={P('users:manage', <Staff />)} />
          <Route path="/settings" element={P('settings:manage', <SettingsPage />)} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        <Route element={<RequireAuth role="customer"><Suspense fallback={<PageLoader />}><PortalShell /></Suspense></RequireAuth>}>
          <Route path="/portal" element={<PortalDashboard />} />
          <Route path="/portal/subscriptions" element={<PortalSubscriptions />} />
          <Route path="/portal/subscriptions/:id" element={<PortalSubscriptionDetail />} />
          <Route path="/portal/invoices" element={<PortalInvoices />} />
          <Route path="/portal/invoices/:id" element={<PortalInvoiceDetail />} />
          <Route path="/portal/payments" element={<PortalPayments />} />
          <Route path="/portal/quotations" element={<PortalQuotations />} />
          <Route path="/portal/plans" element={<PortalPlans />} />
          <Route path="/portal/profile" element={<PortalProfile />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <EmptyState title="Page not found" description="The page you’re looking for doesn’t exist." action={<Button onClick={() => (window.location.href = '/')}>Go home</Button>} />
    </div>
  );
}
