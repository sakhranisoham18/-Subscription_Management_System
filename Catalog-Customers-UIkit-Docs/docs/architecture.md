# Architecture & key workflows

## System context

```mermaid
flowchart LR
  subgraph Browser
    A[React + TypeScript SPA<br/>Admin / Staff workspace · Customer portal]
  end
  subgraph Server["Express + TypeScript API (/api/v1)"]
    M[Auth · RBAC · Zod validation · rate limits]
    S[Modules: customers · catalogue · quotations · subscriptions ·<br/>invoices · payments · reports · portal]
    D[Domain layer<br/>pricing · discounts · dates · lifecycle · payments]
    B[Billing engine + node-cron scheduler]
    P[PDFKit · Email adapter]
  end
  DB[(PostgreSQL<br/>via Prisma)]
  A -- "REST + JWT (access token in memory,<br/>refresh token in httpOnly cookie)" --> M --> S --> D
  S --> DB
  B --> DB
  B --> P
  S --> P
```

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| Domain | `server/src/domain` | Pure, unit-tested business rules: money (decimal.js), pricing, discount eligibility, billing dates, lifecycles, payment allocation, permissions. No database access. |
| Services | `server/src/services` | Transactional workflows: billing engine, quotation→subscription conversion, subscription lifecycle, pricing resolution, PDFs, email, reports. |
| Modules | `server/src/modules/*` | HTTP routes: validation, authorisation, response shaping. |
| Client | `client/src` | UI only. Totals shown in editors come from the server preview endpoint. |

## Recurring billing (the critical path)

```mermaid
sequenceDiagram
  participant Cron as node-cron / "Run billing now"
  participant Run as runBilling()
  participant DB as PostgreSQL
  Cron->>Run: trigger (SCHEDULED | MANUAL, asOf)
  Run->>DB: INSERT BillingJobRun; acquire run lock (Setting row)
  Run->>DB: expire quotations, auto-renew/close ended subscriptions
  loop batches of 100 (cursor by id)
    Run->>DB: SELECT ACTIVE subs WHERE nextBillingDate <= asOf
    loop each due period of each subscription
      Run->>DB: BEGIN
      Run->>DB: SELECT … FOR UPDATE (subscription row)
      Run->>DB: re-check still due
      alt invoice for billingPeriodKey exists
        Run->>DB: advance nextBillingDate only (SKIPPED event)
      else
        Run->>DB: evaluate discounts, UPDATE usedCount (conditional), INSERT Invoice + lines + DiscountUsage
        Run->>DB: advance nextBillingDate, INSERT events
      end
      Run->>DB: COMMIT (any error → ROLLBACK, date NOT advanced, FAILED event)
    end
  end
  Run->>DB: finish BillingJobRun (counts, errors); release lock
```

Guarantees: **no duplicates** (unique `Invoice.billingPeriodKey = subscriptionId:periodStart`, row lock, run lock); **nothing skipped** (all overdue periods billed in order); **safe retry** (failed period keeps its date, next run retries it); **bounded work** (batches, per-period transactions).

## Lifecycles

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Draft
  Draft --> Quotation: send quotation
  Draft --> Confirmed
  Quotation --> Confirmed: quotation accepted
  Confirmed --> Active: activate (first billing date set)
  Active --> Paused
  Paused --> Active: resume
  Active --> Closed: close early / expiry
  Paused --> Closed
  Draft --> Closed: cancel
  Closed --> Active: renew (expired subscriptions)
```

Invoice: `Draft → Confirmed → Partially paid → Paid`, `Cancelled` (only when unpaid). **Overdue** is derived (open + balance > 0 + due date passed), never stored. Quotation: `Draft → Sent → Accepted → Converted`, plus `Rejected`, `Expired`.

## Data model

See `server/prisma/schema.prisma`. Core relations:

```mermaid
erDiagram
  User ||--o| Customer : "portal login"
  Customer ||--o{ Quotation : has
  Customer ||--o{ Subscription : has
  Customer ||--o{ Invoice : has
  Customer ||--o{ Payment : makes
  Quotation ||--|{ QuotationLine : contains
  Subscription ||--|{ SubscriptionLine : contains
  Subscription ||--o{ Invoice : "bills (unique per period)"
  Invoice ||--|{ InvoiceLine : contains
  Payment ||--|{ PaymentAllocation : "allocated via"
  Invoice ||--o{ PaymentAllocation : receives
  Product ||--o{ ProductVariant : "price adjustment"
  SubscriptionPlan ||--o{ Subscription : "template for"
  Discount ||--o{ DiscountUsage : tracks
  TaxRule ||--o{ SubscriptionLine : "rate source"
```

Historical lines **snapshot** description, unit price, discount and tax rate, so editing or archiving a product never changes past quotations, subscriptions or invoices.
