# Permission matrix — Brightloop Software Subscription Management System

Single source of truth: `server/src/domain/permissions.ts`. Every API route is guarded by `requirePermission(...)` on the **server**; the client only mirrors the matrix to hide controls. The same matrix is viewable by admins in **Settings → Permissions**.

| Capability | Admin | Internal staff | Customer |
|---|:-:|:-:|:-:|
| Create / manage **staff accounts** | ✅ | ❌ | ❌ |
| Settings (company, currency, timezone, billing defaults), audit log, dev outbox | ✅ | ❌ | ❌ |
| Products, variants — view | ✅ | ✅ | ❌ |
| Products, variants — create / edit / archive | ✅ | ❌ (read-only) | ❌ |
| Subscription plans — view | ✅ | ✅ | portal catalogue only |
| Subscription plans — create / edit | ✅ | ❌ | ❌ |
| **Discount rules** — view | ✅ | ✅ | ❌ |
| **Discount rules** — create / edit | ✅ | ❌ | ❌ |
| Tax rules — view / manage | ✅ / ✅ | ✅ / ❌ | ❌ |
| Quotation templates | ✅ | ✅ | ❌ |
| Customers (create, edit, invite to portal) | ✅ | ✅ | own profile only |
| Quotations (create, send, accept, convert) | ✅ | ✅ | own: view, accept, decline |
| Subscriptions (create, confirm, activate, pause, renew, close) | ✅ | ✅ | own: view + request changes |
| Review customer change requests | ✅ | ✅ | submit only |
| Invoices (create manual, confirm, cancel, send, PDF) | ✅ | ✅ | own (non-draft): view + PDF |
| Record payments | ✅ | ✅ | ❌ (own history: view) |
| **Void** a payment | ✅ | ❌ | ❌ |
| Run billing now / preview / history | ✅ | ✅ | ❌ |
| Dashboard (overview) | ✅ | ✅ | own portal dashboard |
| Finance reports + CSV/PDF export | ✅ | ❌ | ❌ |

## Why these choices

Where the brief is explicit it is followed literally:

* "Only the admin can add a new member of staff" → `users:manage` is admin-only.
* "Only the admin can create discount rules" → `discounts:write` is admin-only (staff can *apply* eligible discounts on quotations).
* "The admin sets up products, plans, taxes" → write access admin-only; the report's "Manage products and plans: Staff = *Limited*" is implemented as **read-only**.
* "Finance analytics: Staff = *Limited*" → staff see the operational overview dashboard (KPIs, recent activity) but not the full finance report / exports.

The report's fourth persona, **Finance manager**, is served by the Admin role (full reports). Adding a dedicated `FINANCE` role later only needs a new enum value and edits to this file.

## Customer data isolation

Customer endpoints live under `/api/v1/portal/*`. The customer id is taken from the authenticated **server-side session**, never from the URL or body, and every query is filtered by it. Requesting another customer's record returns **404** (not 403), so existence is not disclosed. Draft invoices, quotations and subscriptions are hidden from customers. Profile updates use a strict whitelist (email/status cannot be changed — mass-assignment protection).
