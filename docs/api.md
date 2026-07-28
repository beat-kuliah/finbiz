# FinBiz API Reference

Base URL: `http://localhost:8080`

All error responses use:

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

Authenticated tenant routes require `Authorization: Bearer <accessToken>`.
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
| POST | `/api/auth/register` | — | Register new user (starts trial) |
| POST | `/api/auth/login` | — | Login with email/password |
| POST | `/api/auth/refresh` | Cookie | Rotate access token via refresh cookie |
| POST | `/api/auth/logout` | Cookie | Revoke refresh token |
| GET | `/api/auth/me` | Bearer | Current user profile |
| POST | `/api/auth/google` | — | Google OAuth (stub — not implemented) |
| POST | `/api/auth/forgot-password` | — | Request password reset email (stub) |
| POST | `/api/auth/reset-password` | — | Reset password with token (stub) |

### POST `/api/auth/register`

```json
{ "email": "user@example.com", "name": "User Name", "password": "secret123" }
```

Response: `{ "accessToken": "...", "user": { ... } }` + sets `finbiz_refresh` cookie.

### POST `/api/auth/login`

```json
{ "email": "user@example.com", "password": "secret123" }
```

---

## Organizations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orgs` | Bearer | List user's organizations |
| POST | `/api/orgs` | Bearer | Create organization (seeds COA) |
| GET | `/api/orgs/:orgId` | Bearer | Get organization detail |
| PATCH | `/api/orgs/:orgId` | Bearer | Update organization (stub) |
| GET | `/api/orgs/:orgId/members` | Bearer | List members (stub) |
| POST | `/api/orgs/:orgId/invites` | Bearer | Invite member (stub) |
| DELETE | `/api/orgs/:orgId/members/:userId` | Bearer | Remove member (stub) |

### POST `/api/orgs`

```json
{
  "name": "Toko Saya",
  "businessType": "umkm",
  "openingCash": 5000000
}
```

Creates org, seeds Indonesian UMKM chart of accounts, optionally posts opening cash journal (Kas debit / Modal credit).

---

## Accounts (Chart of Accounts)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orgs/:orgId/accounts` | Bearer | List accounts (stub) |
| POST | `/api/orgs/:orgId/accounts` | Bearer | Create account (stub) |
| GET | `/api/orgs/:orgId/accounts/:accountId` | Bearer | Get account (stub) |
| PATCH | `/api/orgs/:orgId/accounts/:accountId` | Bearer | Update account (stub) |

---

## Documents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orgs/:orgId/documents` | Bearer | List documents (stub) |
| POST | `/api/orgs/:orgId/documents` | Bearer | Create document (stub) |
| GET | `/api/orgs/:orgId/documents/:docId` | Bearer | Get document (stub) |
| POST | `/api/orgs/:orgId/documents/:docId/post` | Bearer | Post document to ledger (stub) |
| POST | `/api/orgs/:orgId/documents/:docId/void` | Bearer | Void document (stub) |

Document types: `invoice`, `bill`, `payment`, `receipt`, `journal`, `adjustment`, `other`.

---

## Journals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orgs/:orgId/journals` | Bearer | List journal entries (stub) |
| POST | `/api/orgs/:orgId/journals` | Bearer | Post balanced journal entry (stub route) |
| GET | `/api/orgs/:orgId/journals/:entryId` | Bearer | Get journal entry (stub) |
| POST | `/api/orgs/:orgId/journals/:entryId/void` | Bearer | Void journal entry (stub route) |

Core ledger module (`postJournal`, `voidJournal`) is implemented in `src/modules/ledger/journal.ts`.

### POST journal body (planned)

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

## Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orgs/:orgId/reports/trial-balance` | Bearer | Trial balance (stub) |
| GET | `/api/orgs/:orgId/reports/profit-loss` | Bearer | Profit & loss (stub) |
| GET | `/api/orgs/:orgId/reports/balance-sheet` | Bearer | Balance sheet (stub) |
| GET | `/api/orgs/:orgId/reports/general-ledger` | Bearer | General ledger (stub) |
| GET | `/api/orgs/:orgId/reports/cash-flow` | Bearer | Cash flow (stub) |

Query params: `from`, `to`, `periodId`.

---

## Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/billing/plans` | — | List plan catalog (stub) |
| GET | `/api/billing/subscription` | Bearer | Current subscription (stub) |
| POST | `/api/billing/subscribe` | Bearer | Start paid subscription via Midtrans (stub) |
| POST | `/api/billing/webhook/midtrans` | — | Midtrans payment webhook (stub) |
| POST | `/api/billing/cancel` | Bearer | Cancel subscription (stub) |

Plans: `trial`, `starter`, `pro`, `business`.

---

## Platform Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/platform/auth/login` | — | Platform admin login |
| POST | `/api/platform/auth/refresh` | Cookie | Refresh admin token |
| POST | `/api/platform/auth/logout` | Cookie | Admin logout |
| GET | `/api/platform/auth/me` | Bearer (platform) | Admin profile |
| GET | `/api/platform/users` | Bearer (platform) | List users (stub) |
| GET | `/api/platform/orgs` | Bearer (platform) | List all orgs (stub) |
| GET | `/api/platform/settings` | Bearer (platform) | App settings (stub) |
| PATCH | `/api/platform/settings` | Bearer (platform) | Update app settings (stub) |
| GET | `/api/platform/plans` | Bearer (platform) | Manage plan catalog (stub) |
| POST | `/api/platform/license-keys` | Bearer (platform) | Issue license key (stub) |

Platform admin seeded via `npm run db:seed` using `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`.

---

## License (Self-host)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/license/activate` | Bearer | Activate self-host license key (stub) |
| GET | `/api/license/status` | Bearer | License status (stub) |
| POST | `/api/license/validate` | — | Validate license signature (stub) |

Used when `DEPLOYMENT_MODE=selfhost`.

---

## Mail Test

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/platform/mail/test` | Bearer (platform) | Send test email via SMTP (stub) |

SMTP configured via `SMTP_*` env vars.

---

## Entitlements

Module at `src/modules/entitlements/` provides:

- `assertEntitled(userId, action)` — plan feature gates
- `assertWithinLimit(userId, limit, orgId?)` — org/seat limits from `plan_catalog`
- `assertWritable(userId, orgId)` — subscription active + non-viewer role

Actions: `create_org`, `invite_member`, `post_journal`, `export_report`, `manage_fixed_assets`.

---

## Database Tables

`users`, `organizations`, `memberships`, `accounts`, `contacts`, `documents`, `journal_entries`, `journal_lines`, `open_items`, `fixed_assets`, `depreciation_runs`, `fiscal_periods`, `app_settings`, `plan_catalog`, `subscriptions`, `billing_events`, `license_keys`, `invites`, `audit_logs`, `document_sequences`.

Refresh tokens are stored in Redis, not PostgreSQL.
