# FinBiz API Reference

Base URL: `http://localhost:8080`

All error responses use:

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

Authenticated tenant routes require `Authorization: Bearer <accessToken>`.
Org-scoped routes also require `X-Organization-Id: <orgUuid>`.
Refresh tokens are stored in HttpOnly cookies (`finbiz_refresh` for tenant, `finbiz_admin_refresh` for platform admin).

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | — | Liveness check → `{ "ok": true }` |

---

## Auth (Tenant)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register (starts trial); sends welcome email |
| POST | `/api/auth/login` | — | Login with email/password |
| POST | `/api/auth/google` | — | Google GIS ID token → session |
| POST | `/api/auth/forgot-password` | — | Request reset email (always 200) |
| POST | `/api/auth/reset-password` | — | Reset password with Redis token |
| POST | `/api/auth/refresh` | Cookie | Rotate access token |
| POST | `/api/auth/logout` | Cookie | Revoke refresh token |
| GET | `/api/auth/me` | Bearer | Current user profile |

### POST `/api/auth/register`

```json
{ "email": "user@example.com", "name": "User Name", "password": "secret123" }
```

### POST `/api/auth/google`

```json
{ "idToken": "<Google GIS credential>" }
```

Requires `GOOGLE_CLIENT_ID` in backend env.

### POST `/api/auth/forgot-password` / `reset-password`

```json
{ "email": "user@example.com" }
```

```json
{ "token": "...", "password": "newpassword" }
```

---

## Organizations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orgs` | Bearer | List user's organizations |
| POST | `/api/orgs` | Bearer | Create organization (seeds COA) |
| GET | `/api/orgs/:orgId` | Bearer | Get organization detail |
| PATCH | `/api/orgs/:orgId` | Bearer | Update name / businessType |
| GET | `/api/orgs/:orgId/members` | Bearer | List members |
| POST | `/api/orgs/:orgId/invites` | Bearer | Invite member (email + role) |
| DELETE | `/api/orgs/:orgId/members/:userId` | Bearer | Remove member |
| POST | `/api/orgs/invites/accept` | Bearer | Accept invite by token |
| GET | `/api/orgs/:orgId/export` | Bearer | Export org data (entitlement) |

### POST `/api/orgs`

```json
{
  "name": "Toko Saya",
  "businessType": "umkm",
  "openingCash": 5000000
}
```

### POST `/api/orgs/:orgId/invites`

```json
{ "email": "colleague@example.com", "role": "accountant" }
```

Roles: `admin`, `accountant`, `viewer`.

---

## Accounts (Chart of Accounts)

Header: `X-Organization-Id`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/accounts` | Bearer+Org | List accounts with balances |
| POST | `/api/accounts` | Bearer+Org | Create account |
| PATCH | `/api/accounts/:id` | Bearer+Org | Update code/name |
| GET | `/api/accounts/:id/ledger` | Bearer+Org | Account ledger lines |

---

## Contacts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/contacts` | Bearer+Org | List contacts |
| POST | `/api/contacts` | Bearer+Org | Create contact |
| GET | `/api/contacts/:id` | Bearer+Org | Get contact |
| PATCH | `/api/contacts/:id` | Bearer+Org | Update contact |
| DELETE | `/api/contacts/:id` | Bearer+Org | Delete contact |

Kinds: `customer`, `vendor`, `lender`, `other`.

---

## Documents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/documents` | Bearer+Org | List documents |
| POST | `/api/documents` | Bearer+Org | Create cash document + journal |

Kinds: `cash_in`, `cash_out`, `transfer`, `capital`.

---

## Journals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/journals` | Bearer+Org | List journal entries |
| POST | `/api/journals` | Bearer+Org | Post balanced manual journal |
| GET | `/api/journals/:id` | Bearer+Org | Get entry + lines |
| POST | `/api/journals/:id/void` | Bearer+Org | Void entry |

### POST `/api/journals`

```json
{
  "date": "2026-01-15",
  "description": "Penyesuaian",
  "lines": [
    { "accountId": "uuid", "debit": 100000, "credit": 0 },
    { "accountId": "uuid", "debit": 0, "credit": 100000 }
  ]
}
```

---

## AR/AP

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/open-items` | Bearer+Org | List open items |
| POST | `/api/invoice` | Bearer+Org | Create AR invoice |
| POST | `/api/receipt` | Bearer+Org | Record receipt against AR |
| POST | `/api/loan-in` | Bearer+Org | Record loan received |
| POST | `/api/loan-payment` | Bearer+Org | Loan repayment |

---

## Fixed Assets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/assets` | Bearer+Org | List assets |
| POST | `/api/assets` | Bearer+Org | Create asset |
| POST | `/api/assets/depreciate` | Bearer+Org | Run depreciation for periodYm |
| POST | `/api/assets/:id/dispose` | Bearer+Org | Dispose asset |

---

## Reports & Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard` | Bearer+Org | Org dashboard KPIs |
| GET | `/api/dashboard/consolidated` | Bearer | Cross-org dashboard |
| GET | `/api/reports/profit-loss` | Bearer+Org | P&L |
| GET | `/api/reports/balance-sheet` | Bearer+Org | Balance sheet |
| GET | `/api/reports/trial-balance` | Bearer+Org | Trial balance |
| GET | `/api/reports/cash-flow` | Bearer+Org | Cash flow |
| GET | `/api/reports/aging` | Bearer+Org | AR/AP aging |

Query params: `from`, `to` (YYYY-MM-DD).

---

## Periods

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/periods` | Bearer+Org | List fiscal periods |
| POST | `/api/periods/close` | Bearer+Org | Close period + closing entries |

```json
{ "endDate": "2026-12-31" }
```

---

## Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/billing/plans` | — | Active plan catalog |
| GET | `/api/billing/subscription` | Bearer | Current subscription |
| GET | `/api/billing/usage` | Bearer | Org/seat usage |
| POST | `/api/billing/checkout` | Bearer | Midtrans Snap (mock if no key) |
| POST | `/api/billing/webhook/midtrans` | — | Payment webhook (+ signature) |
| POST | `/api/billing/cancel` | Bearer | Cancel subscription |
| POST | `/api/billing/change-plan` | Bearer | Change plan code |
| GET | `/api/billing/invoices` | Bearer | Billing events as invoices |

Plans: `trial`, `starter`, `pro`, `business`.

Checkout returns `{ snapToken, redirectUrl, orderId, mock }`. When `MIDTRANS_SERVER_KEY` is set, Snap is real; otherwise `mock: true`.

---

## License (Self-host)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/license/activate` | Bearer | Activate license key |
| GET | `/api/license/status` | Bearer | License status |

Enabled when `DEPLOYMENT_MODE=selfhost` or `SELFHOST_UNLOCK=true`.

---

## Audit Logs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/audit-logs` | Bearer+Org | Recent audit entries (`?limit=`) |

Writes happen on journal post/void, documents, invites, period close, asset create/dispose.

---

## Platform Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/platform/auth/login` | — | Platform admin login |
| POST | `/api/platform/auth/refresh` | Cookie | Refresh admin token |
| POST | `/api/platform/auth/logout` | Cookie | Admin logout |
| GET | `/api/platform/auth/me` | Bearer (platform) | Admin profile |
| GET | `/api/platform/overview` | Bearer (platform) | Counts + trialDays |
| GET | `/api/platform/users` | Bearer (platform) | List users |
| GET | `/api/platform/subscriptions` | Bearer (platform) | List subscriptions |
| GET | `/api/platform/billing-events` | Bearer (platform) | Billing events |
| GET/PUT | `/api/platform/settings` | Bearer (platform) | App settings |
| POST | `/api/platform/settings/test-email` | Bearer (platform) | SMTP test |
| GET/POST | `/api/platform/plans` | Bearer (platform) | Plan catalog |
| GET/PUT | `/api/platform/plans/:code` | Bearer (platform) | Get/update plan |
| POST | `/api/platform/users/:id/extend-trial` | Bearer (platform) | Extend trial |
| POST | `/api/platform/users/:id/set-plan` | Bearer (platform) | Set plan manually |
| POST | `/api/platform/licenses` | Bearer (platform) | Issue license key |

Platform admin seeded via `make seed` using `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`.

---

## Entitlements

`billing.AssertEntitled` / `AssertWithinLimit` / `AssertWritable` gate:

- `create_org`, `invite_member`, `post_journal`, `export_report`, `manage_fixed_assets`
- Limits: `max_orgs`, `max_seats` from `plan_catalog`
- Viewers are read-only; expired trial → read-only

---

## Database Tables

`users`, `organizations`, `memberships`, `accounts`, `contacts`, `documents`, `journal_entries`, `journal_lines`, `open_items`, `fixed_assets`, `depreciation_runs`, `fiscal_periods`, `app_settings`, `plan_catalog`, `subscriptions`, `billing_events`, `license_keys`, `invites`, `audit_logs`, `document_sequences`.

Refresh / password-reset tokens are stored in Redis, not PostgreSQL.
