# Brightloop – 4-member split

Each member owns a vertical slice (API + UI + tests). Hand-written lines are about equal (about 4.0k to 4.6k each).

| # | Module | Owns |
|---|--------|------|
| 1 | Foundation, Auth, Users, Settings | Root and tooling config, Prisma schema + migration, server config/lib/middleware, auth/users/settings API, client bootstrap (App, lib, auth provider), login/register/forgot/reset, Profile, Staff, Settings pages |
| 2 | Catalog, Customers, UI kit, Docs | Products/plans/taxes/templates/discounts API and pricing rules, customers API, seed data, shared UI components and layout, catalog and customer pages, OpenAPI/Postman/architecture docs |
| 3 | Subscriptions, Billing, Quotations | Lifecycle and date rules, subscription and request APIs, billing engine and scheduler, quotation service/API, subscription/billing/quotation pages, line editors, lifecycle/billing/dates/rules tests |
| 4 | Invoices, Payments, Reports, Portal | Invoice and payment APIs, reports, PDF, email, notifications, customer portal API and all portal pages, invoice/payment/report/overview pages, charts, sales-payments and email tests |

Every file in the project is assigned to exactly one member (150 files).

## How to upload
1. One person creates an empty GitHub repo (no README) and adds all four as collaborators.
2. Everyone extracts the zip and runs the commands from the project root.
3. Member 1 first: `bash git-split/upload.sh 1 https://github.com/ORG/REPO.git`
4. Then members 2, 3, 4 (any order): `bash git-split/upload.sh N https://github.com/ORG/REPO.git`
5. Each pushes `feature/memberN` with one commit per area. Open a PR (the script does it if `gh` is installed) and merge into `main`.

Commits are made under each person's own git `user.name` / `user.email`, so set those first:
`git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`.
