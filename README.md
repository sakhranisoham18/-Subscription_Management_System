# Brightloop Software — Subscription Management System

One platform for plans, quotations, subscriptions, recurring billing, payments and revenue reporting. Built for the Brightloop Software challenge brief (Odoo × FLUX Lucknow Hackathon '26). The brief does not mandate a stack; this is an independent web application (React · TypeScript · Node · Express · PostgreSQL · Prisma).

> **Status:** built, type-checked, linted, seeded and tested (98/98 tests pass) and exercised end to end in a real browser — including load testing at ~6 k subscriptions, keyboard-only navigation, WCAG accessibility scanning (zero violations), and tablet/mobile layout checks. See [Verification status](#verification-status) for exactly what was and was not verified.

## Quick start

Requirements: Node 20+, Docker (for PostgreSQL) or any PostgreSQL 14+.

```bash
cp server/.env.example server/.env       # placeholders only — edit secrets
docker compose up -d                     # PostgreSQL on :5432 (+ a separate test database)
npm install                              # installs both workspaces
npm run db:generate --workspace server   # generate Prisma client
npm run db:deploy                        # apply the committed migration
npm run db:seed                          # load the demo dataset
npm run dev                              # API :4000 · web :5173
```

Open <http://localhost:5173>. API docs: <http://localhost:4000/api/docs>.

### Demo accounts (fictional, **development only** — never use in production)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@brightloop.demo` | `Admin@12345` |
| Internal staff | `staff@brightloop.demo` | `Staff@12345` |
| Customer A (Sharma Retail) | `customer@brightloop.demo` | `Customer@123` |
| Customer B (Kapoor Logistics) | `customer.b@brightloop.demo` | `Customer@123` |

The seed (`server/prisma/seed.ts`) wipes the database and loads ~24 customers, products with variants (incl. **Odoo brand +₹560**), daily/weekly/monthly/yearly plans, tax rules, fixed + percentage discounts (live, expired, scheduled, usage-capped), quotations in every state, subscriptions in Draft/Quotation/Confirmed/Active/Paused/Closed, ~12 months of invoices (Draft/Open/Partially paid/Paid/Overdue/Cancelled) and payments by several methods, so dashboards and reports are populated immediately. It leaves some subscriptions **due for billing today** so the billing preview has work to do.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API and web app with reload |
| `npm run db:migrate` / `db:deploy` | Create/apply migrations (dev / production) |
| `npm run db:seed` / `db:reset` | Reload demo data / drop and recreate |
| `npm run db:seed:load --workspace server` | Load-test data: ~6 k subscriptions, ~34 k invoices, ~31 k payments (idempotent) |
| `npm run billing:run -- [YYYY-MM-DD]` | Run recurring billing once from the CLI |
| `npm test` | Unit + integration tests (needs `TEST_DATABASE_URL`) |
| `npm run typecheck` · `npm run lint` | Static checks |
| `npm run build` | Production builds |

## Environment variables

`server/.env` (see `server/.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `TEST_DATABASE_URL` | PostgreSQL connections (tests **wipe** the test DB) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥32 chars each; generate with `openssl rand -hex 48` |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | Session lifetimes (15m / 7d) |
| `CLIENT_ORIGIN`, `APP_URL` | Allowed browser origin(s); public web URL used in emailed links |
| `COOKIE_SAMESITE`, `COOKIE_SECURE` | Use `none` + HTTPS when API and web are on different sites |
| `BILLING_SCHEDULER_ENABLED`, `BILLING_CRON`, `BILLING_BATCH_SIZE`, `APP_TIMEZONE` | Scheduler (default daily 02:00, Asia/Kolkata) |
| `SMTP_*`, `MAIL_FROM` | Email. **Leave `SMTP_HOST` empty for development mode** |

`client/.env`: `VITE_API_URL` (empty in dev; API origin in production).

## Feature tour (maps to the brief)

| Brief scene | Where |
|---|---|
| New customer signs up; unique email; password policy; reset link | `/register`, `/forgot-password`, `/reset-password` |
| Roles: admin, staff, customer portal; only admin adds staff | **Staff** page (admin), `/portal/*`, [permission matrix](docs/permission-matrix.md) |
| Product with variants (Odoo = +560); plans with frequency, min qty, availability, close/pause/renew options | **Products**, **Plans** |
| Quotation from a template; subscription with numbered lifecycle Draft → Quotation → Confirmed → Active → Closed | **Quotation templates**, **Quotations**, **Subscriptions** |
| Billing day: invoices created automatically, taxes from rules, confirm/cancel/send/print, never twice or skipped | **Recurring billing**, **Invoices**, scheduler |
| Discounts: fixed/%, min purchase/qty, dates, usage cap, product/subscription scope, applied automatically | **Discounts & taxes** (admin creates) |
| Payments by method, against invoices, paid vs outstanding vs overdue | **Payments**, invoice detail |
| Finance lead: active subs, revenue, outstanding, overdue, filters, exports | **Reports**, **Overview** |

## Demo walkthroughs (Scenarios A–G)

1. **A – Onboarding:** register → land on the customer dashboard → *Forgot password* → open **Settings → Dev outbox** as admin (dev mode: no SMTP) and click the link.
2. **B – Product → quotation:** Admin: *Products → New* (add variant Brand: Odoo +560) → *Plans → New* → *Customers → New* → *Quotations → New* (pick a template, product + variant lines, an eligible discount) → *Send to customer* (PDF is attached to the logged email) / open PDF.
3. **C – Quote → active subscription:** *Mark accepted* (or the customer accepts in the portal) → *Convert to subscription* → *Activate*. Sign in as the customer: only their subscription is visible.
4. **D – Recurring billing:** open the subscription → *Change next billing date* to today (or use a seeded due one) → **Recurring billing** preview → *Run billing now* → invoice created, next billing date advanced → run again: *0 invoices created*.
5. **E – Payments & overdue:** *Confirm* the draft invoice → *Record payment* (partial) → balance shown, status *Partially paid* → pay the remainder → *Paid*. Seeded overdue invoices appear under *Invoices → Overdue* and on the dashboard.
6. **F – Reports:** *Reports* → pick a range → compare invoiced / collected / outstanding / overdue / MRR → *Export* (PDF, CSV).
7. **G – Security:** sign in as Customer A and open a Customer B invoice URL (404); as staff open `/staff` (blocked) or call `POST /api/v1/users` (403); as admin everything works.

## Financial rules (as implemented)

* **Money:** `NUMERIC(14,2)` columns; all arithmetic in `decimal.js`; round **half-up to 2 dp per line**; totals are sums of rounded lines so documents always add up. Default currency **INR**, configurable in Settings.
* **Variant price** = product sales price + variant price adjustment (configurable; may be negative but never below zero).
* **Order of operations:** gross (qty × unit) → line discount % → document discount (fixed or %, allocated across eligible lines proportionally) → **discounts apply BEFORE tax** → tax on the discounted amount, per line from the line's tax rule. Report example verified in tests: 5 × ₹2,560 = 12,800 − 10% = 11,520 + 18% = **₹13,593.60**.
* **Billing in advance:** the first invoice is generated on the start date; the invoice covers `[period start, next start − 1 day]`; due date = invoice date + payment terms.
* **Month-end rule:** a subscription remembers its anchor day. Monthly/yearly steps land on the anchor day, clamped to the month's last day (31 Jan → 28/29 Feb → 31 Mar; 29 Feb yearly → 28 Feb → 29 Feb in leap years).
* **Pause/resume:** no invoices while paused; periods inside the pause are not billed. On resume, if the next date has passed, billing restarts on the resume date and the cycle is re-anchored.
* **Plan changes** affect new subscriptions only; existing subscriptions keep their frequency, prices and lines (snapshot). Editing lines of a confirmed/active subscription applies from the next invoice.
* **MRR** = Σ over Active subscriptions of (subtotal − line/doc discounts, before tax) normalised to a month: daily × 365/12, weekly × 52/12, monthly × 1, yearly ÷ 12 (÷ billing interval). ARR = MRR × 12.
* **Invoiced revenue** = confirmed/partially-paid/paid invoices dated in range (drafts and cancelled excluded). **Collected** = completed payments dated in range (voided excluded). **Outstanding** = balance of open invoices. **Overdue** = outstanding where due date < today (derived).
* **Discount usage** is incremented with a conditional `UPDATE … WHERE usedCount < usageLimit`, so concurrent runs cannot exceed the cap. Cancelling an invoice releases its usage. One document-level discount (the largest eligible saving) applies per invoice.
* **Tax rules** are admin-managed; a changed rate affects invoices generated from then on, issued invoices keep their rate.
* **Timezones:** business dates are `DATE` columns handled as UTC-midnight values; "today" is evaluated in `APP_TIMEZONE`; timestamps are stored UTC and displayed in the configured timezone.

## Assumptions made (flagged because the brief leaves them open)

1. Three roles (Admin, Staff, Customer). The report's "Finance manager" is covered by Admin reporting.
2. Staff cannot edit products/plans/taxes/discounts (report: "Limited"); they can view them and apply eligible discounts.
3. Recurring invoices are created as **Draft** for review by default; enable *Confirm recurring invoices automatically* in Settings to confirm and email them straight away.
4. No payment gateway: payments are recorded manually. Bank-statement import is a documented future extension, not a feature.
5. Overpayments/credit notes are out of MVP scope: allocations may not exceed the outstanding balance. A paid invoice is never silently altered — erroneous payments are **voided** (admin) with an audit trail.
6. Customers request pause/resume/renew/cancel through the portal; staff approve and the same lifecycle rules then apply.
7. One currency per document (INR default).

## Security

bcrypt (cost 12) password hashing; password policy enforced client- and server-side; JWT access tokens (15 min, memory only) + rotating httpOnly refresh cookie with reuse detection; reset tokens are random, single-use, expire in 30 min and only their SHA-256 is stored; generic reset/login responses; login/reset rate limiting; Helmet; CORS allow-list and Origin check on cookie endpoints (CSRF); Zod validation on every body/query/param; whitelisted sort columns and strict update schemas (mass-assignment); Prisma parameterised queries; the server recomputes all prices, tax, discounts and totals; ownership enforced server-side on every portal query; CSV exports neutralise formula injection; audit log for financial and lifecycle actions; secrets only via environment variables.

## Performance

Server-side pagination, filtering and whitelisted sorting everywhere; indexes on email, status, customer, number, due date, next-billing date, invoice date; dashboard and reports use SQL aggregates (`GROUP BY`) and grouped queries (no N+1 for list pages); billing runs in bounded batches with keyset pagination (safe at batch boundaries). **Measured at ~6 k subscriptions / ~34 k invoices / ~31 k payments** (generated by `npm run db:seed:load --workspace server`): all admin pages render in under 1.1 s in Chromium; CSV exports < 1 s (optimised to raw SQL with DB-side formatting); billing batch run processes all due subscriptions; no page exceeds the 2-second target.

## Verification status

Run in a Linux sandbox with Node 22 and PostgreSQL 16 (31 Oct 2026):

| Check | Result |
|---|---|
| `npm install`, Prisma `generate` / `validate` / `migrate` | ✅ Pass |
| Server `tsc --noEmit`, client `tsc -b`, ESLint (both) | ✅ 0 errors, 0 warnings |
| Client production build (`vite build`) | ✅ Pass |
| Seed (`npm run db:seed`) | ✅ 24 customers, 30 subscriptions, 159 invoices, 138 payments |
| Unit + integration tests | ✅ **98 / 98 pass** (8 files) |
| Live API: billing preview → run → run again | ✅ 5 invoices, then 0 (idempotent) |
| Billing batch pagination regression | ✅ Fixed: keyset `id > cursor` replacing unsafe `cursor+skip:1`; regression test confirms 11/11 subscriptions billed across 4 batches |
| Email-failure handling | ✅ Forgot-password gives identical response for known/unknown emails (no account enumeration); invoice confirm with email failure returns 200 + `emailWarning`; quotation send rolls back on email failure |
| RBAC over HTTP (staff → create user 403, customer → back office 403, no token 401) | ✅ |
| Real-browser crawl of every page as Admin, Staff and Customer | ✅ No console errors or failed API calls |
| Real-browser interactive flows (34 distinct flows) | ✅ All pass — including quotation → convert → activate → bill → confirm → partial payment (amounts verified: 5 × ₹2,560 − 5% − doc discount + 18% GST = ₹14,348.80); invoice email/PDF; customer portal change-request; payment concurrency; void/overdue |
| Invoice PDF rendering | ✅ Checked visually; fixed a blank 2nd page and header overlap |
| Performance at ~6 k subscriptions / ~34 k invoices | ✅ All admin pages < 1.1 s; CSV exports < 1 s (raw-SQL export); billing batch run processes all due subscriptions |
| WCAG 2.0/2.1 A + AA accessibility (axe-core) | ✅ **Zero violations** across every page in all three role contexts (Admin / Staff / Customer) |
| Keyboard-only navigation | ✅ All 9 checks pass: sign-in, skip-link, focus ring, dialog focus trap, Escape-returns-focus, combobox arrow-key select, row-action-menu open/close |
| Admin pages at 768 px (tablet) | ✅ No horizontal overflow — tables scroll inside their containers |
| Admin pages at 375 px (mobile) | ✅ No horizontal overflow (data tables scroll within `overflow-x-auto` wrappers; chart overflow clipped by `overflow-x-clip` on `<main>`) |
| Customer portal at 375 px | ✅ No horizontal overflow |
| Concurrent payment safety | ✅ 5 races against ₹2,360 → exactly 3 succeed (correct); duplicate-reference race → exactly 1 succeeds |
| Login rate-limiting (429) | ✅ 6th attempt within 15 min returns 429 |
| Scheduler (node-cron) + real SMTP sink | ✅ Scheduler fires correctly; email delivered to raw-socket SMTP sink with correct headers and PDF attachment |
| `npm audit` | ✅ 0 high/critical vulnerabilities (nodemailer upgraded to ^10.3.1) |
| **Not done:** cross-browser (Chrome only); password-reset clicked through in browser (covered by integration test); deployment to Vercel/Render | — |

Notes: `.npmrc` sets `legacy-peer-deps=true` because npm's default resolver crashed on the workspace tree; `react-is` is declared explicitly for Recharts. Because cookies are origin-checked, open the app at `http://localhost:5173` (matching `CLIENT_ORIGIN`), not `127.0.0.1`.

### Manual QA checklist

- [ ] Register with a weak password → rejected; with a duplicate email in different case → rejected
- [ ] Forgot password → link appears in Dev outbox → reset works once; second use fails
- [ ] Staff cannot open `/staff`, create discounts or products (UI hidden **and** API 403)
- [ ] Customer A cannot open Customer B's invoice/subscription/PDF by URL (404)
- [ ] Variant "Odoo" on a ₹2,000 product shows ₹2,560 on a quotation
- [ ] Quotation → accept → convert: lines, discount, tax and totals identical on the subscription
- [ ] Invalid transitions blocked (e.g. pause a Confirmed subscription)
- [ ] Billing preview lists due subscriptions; run creates invoices; run again creates none
- [ ] Paused / closed subscriptions are not billed
- [ ] Expired and usage-capped discounts are not applied
- [ ] Partial payment → Partially paid + correct balance; remainder → Paid; over-allocation rejected; duplicate reference rejected
- [ ] Void a payment (admin) → balance restored, audit entry present
- [ ] Overdue invoice appears in Invoices (Overdue), dashboard and reports
- [ ] Report CSV and PDF download; filters change figures
- [ ] Layout usable at 375 px, 768 px and desktop widths; keyboard navigation and focus rings visible

## Deployment

* **Database:** managed PostgreSQL (Neon, Supabase, Render, Railway). Set `DATABASE_URL`.
* **API (Render/Railway):** build `npm install && npm run build --workspace server`; release command `npm run db:deploy`; start `npm start --workspace server`. Set all variables above; `NODE_ENV=production`, `COOKIE_SECURE=true`, `CLIENT_ORIGIN`/`APP_URL` = web URL. Run **one** API instance (or keep the scheduler on a single instance; the run lock and unique period key keep extra instances safe).
* **Web (Vercel):** root `client`, build `npm run build`, output `dist`, env `VITE_API_URL=https://<api-host>`; add a rewrite of all paths to `/index.html` for client-side routing. For cross-site cookies set `COOKIE_SAMESITE=none` on the API.
* Do not seed demo data into production (`db:seed` **truncates every table**).

## Project layout

```
client/            React + Vite + Tailwind web app (admin/staff workspace + customer portal)
server/
  prisma/          schema.prisma, migrations/, seed.ts
  src/domain/      pure business rules (money, pricing, discounts, dates, lifecycle, payments, permissions)
  src/services/    billing engine, subscriptions, quotations, reports, pdf, email, notifications
  src/modules/     HTTP routes by domain
  src/jobs/        scheduler + CLI
  tests/           unit/ and integration/
docs/              permission-matrix.md, architecture.md, Postman collection, openapi.json
```
