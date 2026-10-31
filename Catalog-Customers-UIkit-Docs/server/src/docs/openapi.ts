/**
 * API catalogue used to generate the OpenAPI document served at /api/docs and the Postman
 * collection in docs/ (npm run docs:postman). Request bodies are validated by Zod in each route;
 * see the route files for exact field rules.
 */
type Method = 'get' | 'post' | 'patch';
interface Endpoint {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  roles: string;
  body?: Record<string, unknown>;
}

const E = (method: Method, path: string, tag: string, summary: string, roles: string, body?: Record<string, unknown>): Endpoint => ({ method, path, tag, summary, roles, body });

const lineExample = [
  { type: 'PLAN', quantity: 5, discountPercent: '0' },
  { type: 'PRODUCT', productId: '<product-uuid>', variantId: '<variant-uuid>', quantity: 5, discountPercent: '0' },
];

export const ENDPOINTS: Endpoint[] = [
  E('post', '/auth/register', 'Auth', 'Register a customer account', 'Public', { name: 'Asha Verma', email: 'asha@example.com', password: 'Str0ng!Pass', companyName: 'Verma Stores' }),
  E('post', '/auth/login', 'Auth', 'Sign in (returns access token, sets refresh cookie)', 'Public', { email: 'admin@brightloop.demo', password: 'Admin@12345' }),
  E('post', '/auth/refresh', 'Auth', 'Rotate refresh cookie and get a new access token', 'Cookie'),
  E('post', '/auth/logout', 'Auth', 'Revoke the refresh token', 'Cookie'),
  E('post', '/auth/forgot-password', 'Auth', 'Email a time-limited reset link (generic response)', 'Public', { email: 'customer@example.com' }),
  E('post', '/auth/reset-password', 'Auth', 'Set a new password with a reset token', 'Public', { token: '<token>', password: 'N3w!Password' }),
  E('get', '/auth/me', 'Auth', 'Current user and permissions', 'Any'),
  E('patch', '/auth/me', 'Auth', 'Update own name/phone', 'Any', { name: 'New Name' }),
  E('post', '/auth/change-password', 'Auth', 'Change own password', 'Any', { currentPassword: '...', newPassword: '...' }),

  E('get', '/users', 'Staff', 'List staff and admins', 'Admin'),
  E('post', '/users', 'Staff', 'Create a staff/admin account', 'Admin', { name: 'New Staff', email: 'new.staff@brightloop.demo', role: 'STAFF', sendInvite: true }),
  E('patch', '/users/{id}', 'Staff', 'Update role/status (deactivate)', 'Admin', { status: 'INACTIVE' }),
  E('post', '/users/{id}/send-reset', 'Staff', 'Send a password reset link', 'Admin'),

  E('get', '/customers', 'Customers', 'List/search customers (?search=&status=&page=)', 'Admin, Staff'),
  E('get', '/customers/{id}', 'Customers', 'Customer detail with linked records', 'Admin, Staff'),
  E('post', '/customers', 'Customers', 'Create a customer', 'Admin, Staff', { name: 'Rahul Mehta', companyName: 'Mehta Retail', email: 'rahul@mehta.example', city: 'Lucknow' }),
  E('patch', '/customers/{id}', 'Customers', 'Update / deactivate a customer', 'Admin, Staff', { phone: '+91 98765 43210' }),
  E('post', '/customers/{id}/invite', 'Customers', 'Invite customer to the portal', 'Admin, Staff'),

  E('get', '/taxes', 'Catalogue', 'List tax rules', 'Admin, Staff'),
  E('post', '/taxes', 'Catalogue', 'Create tax rule', 'Admin', { name: 'GST 18%', rate: '18', isDefault: true }),
  E('patch', '/taxes/{id}', 'Catalogue', 'Update / archive tax rule', 'Admin', { status: 'ARCHIVED' }),
  E('get', '/products', 'Catalogue', 'List products with variants and final prices', 'Admin, Staff'),
  E('get', '/products/{id}', 'Catalogue', 'Product detail', 'Admin, Staff'),
  E('post', '/products', 'Catalogue', 'Create product (+ variants)', 'Admin', {
    name: 'Brightloop POS',
    productType: 'Software',
    salesPrice: '2000',
    costPrice: '600',
    variants: [{ attribute: 'Brand', name: 'Odoo', priceAdjustment: '560' }],
  }),
  E('patch', '/products/{id}', 'Catalogue', 'Update / archive product', 'Admin', { status: 'ARCHIVED' }),
  E('post', '/products/{id}/variants', 'Catalogue', 'Add variant', 'Admin', { attribute: 'Brand', name: 'Generic', priceAdjustment: '0' }),
  E('patch', '/products/{id}/variants/{variantId}', 'Catalogue', 'Update variant', 'Admin', { priceAdjustment: '600' }),
  E('get', '/plans', 'Catalogue', 'List plans', 'Admin, Staff'),
  E('get', '/plans/{id}', 'Catalogue', 'Plan detail', 'Admin, Staff'),
  E('post', '/plans', 'Catalogue', 'Create plan', 'Admin', { name: 'Growth Monthly', billingFrequency: 'MONTHLY', price: '999', minQuantity: 1, availableFrom: '2026-01-01', termLength: 12 }),
  E('patch', '/plans/{id}', 'Catalogue', 'Update plan', 'Admin', { allowPause: false }),
  E('get', '/discounts', 'Catalogue', 'List discounts (?state=current|expired|exhausted|scheduled)', 'Admin, Staff'),
  E('get', '/discounts/{id}', 'Catalogue', 'Discount detail, usage and history', 'Admin, Staff'),
  E('post', '/discounts', 'Catalogue', 'Create discount rule', 'Admin', { code: 'SEATS10', name: '10% for 10+ seats', type: 'PERCENTAGE', value: '10', minQuantity: 10, startsAt: '2026-01-01', scope: 'ALL', usageLimit: 100 }),
  E('patch', '/discounts/{id}', 'Catalogue', 'Update / deactivate discount', 'Admin', { status: 'ARCHIVED' }),
  E('post', '/discounts/eligible', 'Catalogue', 'Evaluate which discounts apply to draft lines', 'Admin, Staff', { planId: '<plan-uuid>', lines: lineExample }),
  E('get', '/templates', 'Catalogue', 'List quotation templates', 'Admin, Staff'),
  E('post', '/templates', 'Catalogue', 'Create quotation template', 'Admin, Staff', { name: 'Enterprise annual', planId: '<plan-uuid>', validityDays: 30, lines: [{ type: 'PLAN', quantity: 10 }] }),
  E('patch', '/templates/{id}', 'Catalogue', 'Update template', 'Admin, Staff', { validityDays: 45 }),

  E('get', '/quotations', 'Quotations', 'List quotations', 'Admin, Staff'),
  E('get', '/quotations/{id}', 'Quotations', 'Quotation detail', 'Admin, Staff'),
  E('post', '/quotations/preview', 'Quotations', 'Server-side pricing preview', 'Admin, Staff', { planId: '<plan-uuid>', lines: lineExample, discountId: null }),
  E('post', '/quotations', 'Quotations', 'Create quotation (optionally from template)', 'Admin, Staff', { customerId: '<customer-uuid>', planId: '<plan-uuid>', lines: lineExample, validityDays: 30 }),
  E('patch', '/quotations/{id}', 'Quotations', 'Edit draft quotation', 'Admin, Staff'),
  E('post', '/quotations/{id}/send', 'Quotations', 'Send quotation PDF by email', 'Admin, Staff'),
  E('post', '/quotations/{id}/accept', 'Quotations', 'Mark accepted', 'Admin, Staff'),
  E('post', '/quotations/{id}/reject', 'Quotations', 'Mark rejected', 'Admin, Staff', { reason: 'Budget' }),
  E('post', '/quotations/{id}/revise', 'Quotations', 'Back to draft for revision', 'Admin, Staff'),
  E('post', '/quotations/{id}/convert', 'Quotations', 'Convert accepted quotation into a confirmed subscription', 'Admin, Staff', { startDate: '2026-11-01' }),
  E('get', '/quotations/{id}/pdf', 'Quotations', 'Quotation PDF', 'Admin, Staff'),

  E('get', '/subscriptions', 'Subscriptions', 'List (?status=&view=endingSoon|dueForBilling)', 'Admin, Staff'),
  E('get', '/subscriptions/{id}', 'Subscriptions', 'Detail, history, invoices, upcoming billing', 'Admin, Staff'),
  E('post', '/subscriptions', 'Subscriptions', 'Create draft subscription', 'Admin, Staff', { customerId: '<customer-uuid>', planId: '<plan-uuid>', startDate: '2026-11-01', lines: lineExample }),
  E('patch', '/subscriptions/{id}', 'Subscriptions', 'Edit subscription (rules depend on status)', 'Admin, Staff'),
  E('post', '/subscriptions/{id}/send-quotation', 'Subscriptions', 'Draft → Quotation (emails quotation)', 'Admin, Staff'),
  E('post', '/subscriptions/{id}/confirm', 'Subscriptions', '→ Confirmed', 'Admin, Staff'),
  E('post', '/subscriptions/{id}/activate', 'Subscriptions', 'Confirmed → Active', 'Admin, Staff'),
  E('post', '/subscriptions/{id}/pause', 'Subscriptions', 'Active → Paused', 'Admin, Staff', { reason: 'Seasonal' }),
  E('post', '/subscriptions/{id}/resume', 'Subscriptions', 'Paused → Active', 'Admin, Staff'),
  E('post', '/subscriptions/{id}/close', 'Subscriptions', 'Close early / cancel', 'Admin, Staff', { reason: 'Customer request' }),
  E('post', '/subscriptions/{id}/renew', 'Subscriptions', 'Renew for N periods', 'Admin, Staff', { periods: 12 }),
  E('patch', '/subscriptions/{id}/next-billing-date', 'Subscriptions', 'Adjust next billing date (audited)', 'Admin, Staff', { nextBillingDate: '2026-10-31' }),
  E('get', '/requests', 'Subscriptions', 'Customer change requests', 'Admin, Staff'),
  E('post', '/requests/{id}/review', 'Subscriptions', 'Approve / reject a change request', 'Admin, Staff', { decision: 'APPROVED' }),

  E('get', '/billing/preview', 'Billing', 'Subscriptions due for billing (?asOf=)', 'Admin, Staff'),
  E('post', '/billing/run', 'Billing', 'Run recurring billing now', 'Admin, Staff', {}),
  E('get', '/billing/runs', 'Billing', 'Billing run history', 'Admin, Staff'),
  E('get', '/billing/runs/{id}', 'Billing', 'Billing run detail and events', 'Admin, Staff'),

  E('get', '/invoices', 'Invoices', 'List (?status=OVERDUE|OPEN|PAID…&from=&to=)', 'Admin, Staff'),
  E('get', '/invoices/{id}', 'Invoices', 'Invoice detail with payments', 'Admin, Staff'),
  E('post', '/invoices', 'Invoices', 'Create manual invoice', 'Admin, Staff', { customerId: '<customer-uuid>', lines: [lineExample[1]] }),
  E('patch', '/invoices/{id}', 'Invoices', 'Edit draft invoice (due date / notes)', 'Admin, Staff'),
  E('post', '/invoices/{id}/confirm', 'Invoices', 'Draft → Confirmed', 'Admin, Staff', { sendEmail: true }),
  E('post', '/invoices/{id}/cancel', 'Invoices', 'Cancel with reason', 'Admin, Staff', { reason: 'Raised in error' }),
  E('post', '/invoices/{id}/send', 'Invoices', 'Email invoice PDF', 'Admin, Staff'),
  E('get', '/invoices/{id}/pdf', 'Invoices', 'Invoice PDF', 'Admin, Staff'),

  E('get', '/payments', 'Payments', 'Reconciliation list (?from=&to=&method=&customerId=&invoiceId=&status=)', 'Admin, Staff'),
  E('get', '/payments/{id}', 'Payments', 'Payment detail', 'Admin, Staff'),
  E('post', '/payments', 'Payments', 'Record payment and allocate to invoices', 'Admin, Staff', {
    customerId: '<customer-uuid>',
    method: 'BANK_TRANSFER',
    amount: '5000.00',
    paymentDate: '2026-10-31',
    reference: 'UTR123456',
    allocations: [{ invoiceId: '<invoice-uuid>', amount: '5000.00' }],
  }),
  E('post', '/payments/{id}/void', 'Payments', 'Void payment (reverses allocations)', 'Admin', { reason: 'Duplicate entry' }),

  E('get', '/dashboard/summary', 'Reports', 'Admin/staff dashboard KPIs', 'Admin, Staff'),
  E('get', '/reports/finance', 'Reports', 'Finance report (?from=&to=&billingFrequency=&customerId=&planId=&invoiceStatus=&paymentMethod=)', 'Admin'),
  E('get', '/reports/finance/export.csv', 'Reports', 'CSV export (?kind=summary|invoices|payments)', 'Admin'),
  E('get', '/reports/finance/export.pdf', 'Reports', 'PDF export', 'Admin'),

  E('get', '/portal/config', 'Portal', 'Display settings (currency, timezone, company name)', 'Customer'),
  E('get', '/portal/dashboard', 'Portal', 'Customer dashboard', 'Customer'),
  E('get', '/portal/subscriptions', 'Portal', 'Own subscriptions', 'Customer'),
  E('get', '/portal/subscriptions/{id}', 'Portal', 'Own subscription detail', 'Customer'),
  E('post', '/portal/subscriptions/{id}/requests', 'Portal', 'Request pause/resume/renew/cancel', 'Customer', { type: 'PAUSE', message: 'Closed for renovation' }),
  E('get', '/portal/requests', 'Portal', 'Own change requests', 'Customer'),
  E('get', '/portal/invoices', 'Portal', 'Own invoices', 'Customer'),
  E('get', '/portal/invoices/{id}', 'Portal', 'Own invoice detail', 'Customer'),
  E('get', '/portal/invoices/{id}/pdf', 'Portal', 'Own invoice PDF', 'Customer'),
  E('get', '/portal/payments', 'Portal', 'Own payment history', 'Customer'),
  E('get', '/portal/quotations', 'Portal', 'Own quotations', 'Customer'),
  E('get', '/portal/quotations/{id}', 'Portal', 'Own quotation detail', 'Customer'),
  E('get', '/portal/quotations/{id}/pdf', 'Portal', 'Own quotation PDF', 'Customer'),
  E('post', '/portal/quotations/{id}/accept', 'Portal', 'Accept a sent quotation', 'Customer'),
  E('post', '/portal/quotations/{id}/reject', 'Portal', 'Decline a sent quotation', 'Customer', { reason: 'Not now' }),
  E('get', '/portal/plans', 'Portal', 'Browse available plans', 'Customer'),
  E('post', '/portal/plans/{id}/request-quote', 'Portal', 'Request a quotation for a plan', 'Customer', { quantity: 3 }),
  E('get', '/portal/profile', 'Portal', 'Own billing profile', 'Customer'),
  E('patch', '/portal/profile', 'Portal', 'Update own billing profile', 'Customer', { phone: '+91 90000 00000' }),

  E('get', '/settings', 'Settings', 'Company & billing settings', 'Admin, Staff'),
  E('patch', '/settings', 'Settings', 'Update settings', 'Admin', { autoConfirmRecurringInvoices: true }),
  E('get', '/settings/permissions', 'Settings', 'Permission matrix', 'Admin'),
  E('get', '/settings/outbox', 'Settings', 'Development email outbox', 'Admin'),
  E('get', '/settings/audit', 'Settings', 'Audit log', 'Admin'),
  E('get', '/health', 'System', 'Health check (DB connectivity)', 'Public'),
];

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const params = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }));
    paths[e.path] ??= {};
    paths[e.path][e.method] = {
      tags: [e.tag],
      summary: e.summary,
      description: `Roles: ${e.roles}`,
      security: ['Public', 'Cookie'].includes(e.roles) ? [] : [{ bearer: [] }],
      parameters: params,
      ...(e.body ? { requestBody: { content: { 'application/json': { example: e.body, schema: { type: 'object' } } } } } : {}),
      responses: {
        200: { description: 'OK — `{ data, meta? }`' },
        400: { description: 'Validation error — `{ error: { code, message, details.fields } }`' },
        401: { description: 'Not authenticated' },
        403: { description: 'Not permitted for this role' },
        404: { description: 'Not found (also returned for records owned by another customer)' },
        409: { description: 'Conflict (duplicate)' },
        422: { description: 'Business rule violation' },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Brightloop Software — Subscription Management System API',
      version: '1.0.0',
      description: 'REST API (v1). Authenticate with POST /auth/login and send `Authorization: Bearer <accessToken>`.',
    },
    servers: [{ url: '/api/v1' }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths,
  };
}

export function buildPostman(baseUrl = 'http://localhost:4000/api/v1') {
  const tags = [...new Set(ENDPOINTS.map((e) => e.tag))];
  return {
    info: {
      name: 'Brightloop Software — Subscription Management System',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Run "Auth / Sign in" first; the test script stores the access token in {{token}}.',
    },
    variable: [
      { key: 'baseUrl', value: baseUrl },
      { key: 'token', value: '' },
    ],
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    item: tags.map((tag) => ({
      name: tag,
      item: ENDPOINTS.filter((e) => e.tag === tag).map((e) => ({
        name: e.summary,
        ...(e.path === '/auth/login'
          ? { event: [{ listen: 'test', script: { exec: ['const j = pm.response.json();', "if (j.data) pm.collectionVariables.set('token', j.data.accessToken);"] } }] }
          : {}),
        request: {
          method: e.method.toUpperCase(),
          header: [{ key: 'Content-Type', value: 'application/json' }],
          url: { raw: `{{baseUrl}}${e.path.replace(/\{(\w+)\}/g, ':$1')}`, host: ['{{baseUrl}}'], path: e.path.replace(/\{(\w+)\}/g, ':$1').split('/').filter(Boolean) },
          ...(e.body ? { body: { mode: 'raw', raw: JSON.stringify(e.body, null, 2) } } : {}),
          description: `Roles: ${e.roles}`,
        },
      })),
    })),
  };
}
