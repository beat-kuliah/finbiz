---
name: FinBiz Fullstack Rebuild
overview: Tiga app terpisah — frontend, backend, frontend-admin — akuntansi lengkap + SaaS trial 3 bulan (editable) + Midtrans + self-host + email SMTP mail.fransiskus-richard.my.id; P0 lalu W1–W9 paralel.
todos:
  - id: p0-contracts
    content: "P0: scaffold frontend/ + backend/ + frontend-admin/; schema; contracts; CORS; Makefile secrets"
    status: completed
  - id: w1-auth-orgs
    content: "W1 Auth/Orgs/Seats: JWT+Redis, invite, roles; trial dari app_settings"
    status: completed
  - id: w2-ledger-core
    content: "W2 Ledger: journal engine, cash/capital, void, balances, doc numbering"
    status: completed
  - id: w3-arap
    content: "W3 AR/AP: open_items, partial, aging, PDF invoice pelanggan"
    status: completed
  - id: w4-assets
    content: "W4 Assets: fixed assets, dispose, straight-line depreciation"
    status: completed
  - id: w5-reports
    content: "W5 Reports: P&L/BS/TB/cash-flow, export, period close, dashboard"
    status: completed
  - id: w6-fe-tenant
    content: "W6 frontend/: app tenant — pages, pricing API, paywall, billing, license"
    status: pending
  - id: w7-billing-selfhost
    content: "W7 Billing: Midtrans, change/cancel, entitlements dari plan_catalog"
    status: completed
  - id: w8-saas-ops
    content: "W8 SaaS ops: SMTP mail, banners, usage, audit tenant, data export"
    status: completed
  - id: w9-platform-admin
    content: "W9 frontend-admin/ + /api/platform: monitor, edit trial/harga, CS actions"
    status: pending
  - id: p2-integrate
    content: "P2: merge, e2e tiga app, docs/PLAN.md"
    status: pending
isProject: false
---

# FinBiz — Plan Paralel Multi-Agent

## Struktur repo (3 web/app terpisah)

```
finbiz/
  frontend/              # App pelanggan/tenant (React+Vite) — port 5173
  frontend-admin/        # App platform admin (React+Vite) — port 5174
  backend-go/            # API Go (Chi + pgx + golang-migrate) — port 8080
  backend-ts-archive/    # Arsip Hono/TS (tidak dipakai runtime)
  docs/PLAN.md
  README.md
```

| App | Audience | Dev URL | Proxy/API |
|-----|----------|---------|-----------|
| `frontend` | User bisnis / UMKM | `http://localhost:5173` | Vite proxy `/api` → `:8080` |
| `frontend-admin` | Operator SaaS | `http://localhost:5174` | Vite proxy `/api` → `:8080` |
| `backend-go` | Shared API (modular monolith) | `http://localhost:8080` | Postgres + Redis |

**Backend stack:** Go modular monolith (`cmd/api` + `cmd/worker`), migrasi **golang-migrate**, siap dipecah microservice nanti di batas domain `billing` / `reports` / `worker`.

- **Tidak** ada route `/platform` di dalam `frontend` tenant.
- Admin adalah **SPA terpisah** (deploy domain berbeda di production, mis. `app.finbiz.id` vs `admin.finbiz.id`).
- Backend CORS mengizinkan **kedua origin**; cookie refresh pakai `SameSite=Lax` + origin allowlist.
- Cookie/token admin boleh namespace terpisah (`finbiz_admin_refresh`) agar session tenant & admin tidak bentrok di browser yang sama.

P0: pindahkan FE existing → `frontend/`; scaffold kosong `frontend-admin/` + `backend/`.

---

## Keputusan produk

- Trial default **3 bulan (90 hari)**, tersimpan di `app_settings.trial_days` — **editable** dari `frontend-admin`
- Harga/limit/fitur paket di `plan_catalog` — **editable** admin
- Cloud Midtrans + self-host license
- Platform admin ≠ role org (`owner/admin/accountant/viewer`)

### Seed paket (boleh diubah admin)

| Plan | Bulanan | Tahunan | Orgs | Seats | Catatan |
|------|---------|---------|------|-------|---------|
| trial | 0 / **90 hari** | — | 2 | 1 | full minus export massal |
| starter | 99.000 | 990.000 | 1 | 2 | tanpa assets/tutup buku/aging/export |
| pro | 249.000 | 2.490.000 | 10 | 10 | aset, depresiasi, laporan lengkap, export |
| business | 499.000 | 4.990.000 | 9999 | 9999 | + consolidated, audit, PDF invoice AR |

```env
DATABASE_URL=postgresql://postgres:Admin123@localhost:5432/finbiz
REDIS_URL=redis://:Admin123@localhost:6379/0
DEPLOYMENT_MODE=cloud
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_PRODUCTION=false
SELFHOST_LICENSE_SECRET=change-me
SELFHOST_UNLOCK=false
PLATFORM_ADMIN_EMAIL=admin@finbiz.local
PLATFORM_ADMIN_PASSWORD=Admin123

# Email transactional — SMTP sendiri
SMTP_HOST=mail.fransiskus-richard.my.id
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=admin@fransiskus-richard.my.id
SMTP_PASS=
SMTP_FROM="FinBiz <admin@fransiskus-richard.my.id>"
```

Password SMTP Anda isi sendiri di `.env` (jangan commit). Port default **587 STARTTLS**; jika server hanya 465 SSL, set `SMTP_PORT=465` + `SMTP_SECURE=true`.

### Makefile secrets (root `finbiz/Makefile`)

Di P0 sediakan Makefile agar Anda bisa generate password kuat sendiri, lalu tempel ke Postgres/Redis/SMTP `.env` / konfigurasi server.

```makefile
# Usage:
#   make gen-secrets          # cetak 3 password acak (postgres, redis, smtp)
#   make gen-password         # satu password acak
#   make hash-password P=...  # bcrypt hash (untuk seed PLATFORM_ADMIN_PASSWORD di DB)
#   make env-backend          # buat backend/.env dari .env.example jika belum ada (tidak overwrite)

.PHONY: gen-secrets gen-password hash-password env-backend

gen-password:
	@openssl rand -base64 24 | tr -d '/+=' | head -c 32; echo

gen-secrets:
	@echo "POSTGRES_PASSWORD=$$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
	@echo "REDIS_PASSWORD=$$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
	@echo "SMTP_PASS=$$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
	@echo ""
	@echo "# Tempel manual ke backend/.env dan sesuaikan user Postgres/Redis di server."
	@echo "# Untuk SMTP Anda: SMTP_USER=admin@fransiskus-richard.my.id — isi SMTP_PASS dari panel mail ATAU dari generator di atas jika Anda set password baru di mail server."

hash-password:
	@test -n "$(P)" || (echo "Usage: make hash-password P='your-password'" && exit 1)
	@cd backend && npx --yes bcryptjs-cli "$(P)" 2>/dev/null || node -e "require('bcryptjs').hash('$(P)',10).then(console.log)"

env-backend:
	@test -f backend/.env.example || (echo "missing backend/.env.example" && exit 1)
	@test ! -f backend/.env && cp backend/.env.example backend/.env && echo "Created backend/.env" || echo "backend/.env already exists — not overwritten"
```

Catatan:
- Credential Postgres `Admin123` / Redis `Admin123` yang Anda berikan tetap boleh dipakai lokal; `make gen-secrets` untuk rotasi atau environment baru.
- **SMTP:** karena Anda pakai mail sendiri, `SMTP_PASS` = password mailbox `admin@fransiskus-richard.my.id` yang Anda set di mail server (bukan harus dari generator — generator hanya jika Anda memang ganti password mailbox).
- Makefile **tidak** menulis password ke file otomatis (aman); Anda yang isi.

---

## Arsitektur

```mermaid
flowchart LR
  FE[frontend_5173]
  ADM[frontend_admin_5174]
  API[backend_go_api_8080]
  WRK[backend_go_worker]
  PG[(Postgres)]
  RD[(Redis)]
  FE -->|/api tenant| API
  ADM -->|/api platform| API
  API --> PG
  API --> RD
  WRK --> PG
```

---

## Platform admin (`frontend-admin` + W9)

### Monitor
- Overview: users, orgs, trialing, active paid, MRR kasar, trial habis ≤7 hari
- Tabel users / subscriptions / billing_events

### Atur
- `trial_days`, maintenance
- Edit `plan_catalog` (harga bulan/tahun, limits, feature flags, aktif/nonaktif)
- Extend trial, set-plan manual
- Issue license self-host

### API (hanya `platform_admin`)

| Method | Path |
|--------|------|
| POST | `/api/platform/auth/login` |
| POST | `/api/platform/auth/logout` |
| GET | `/api/platform/auth/me` |
| GET | `/api/platform/overview` |
| GET | `/api/platform/users` |
| GET | `/api/platform/subscriptions` |
| GET | `/api/platform/billing-events` |
| GET/PUT | `/api/platform/settings` |
| GET/PUT | `/api/platform/plans` / `.../:code` |
| POST | `/api/platform/users/:id/extend-trial` |
| POST | `/api/platform/users/:id/set-plan` |
| POST | `/api/platform/licenses` |

Auth platform terpisah endpoint-nya supaya jelas; tetap bisa satu tabel `users` + flag `is_platform_admin` atau tabel `platform_admins`.

---

## Paralel multi-agent

```mermaid
flowchart TB
  P0[P0_Three_Apps_Contracts]
  P0 --> W1[W1_Auth_Seats]
  P0 --> W2[W2_Ledger]
  P0 --> W3[W3_AR_AP]
  P0 --> W4[W4_Assets]
  P0 --> W5[W5_Reports]
  P0 --> W6[W6_frontend_tenant]
  P0 --> W7[W7_Billing]
  P0 --> W8[W8_SaasOps]
  P0 --> W9[W9_frontend_admin]
  W1 --> P2[P2_Integrate]
  W2 --> P2
  W3 --> P2
  W4 --> P2
  W5 --> P2
  W6 --> P2
  W7 --> P2
  W8 --> P2
  W9 --> P2
```

### Ownership anti-bentrok

| WS | Path boleh disentuh |
|----|---------------------|
| P0 | scaffold ketiga folder, schema, docs/api.md, CORS |
| W1 | `backend-go/internal/auth`, `orgs` |
| W2 | `backend-go/internal/ledger` |
| W3 | `backend-go/internal/arap`, `contacts` |
| W4 | `backend-go/internal/assets` |
| W5 | `backend-go/internal/reports` (+ periods di ledger) |
| W6 | **`frontend/**` saja** |
| W7 | `backend-go/internal/billing` |
| W8 | `backend-go/internal/mail` + `cmd/worker` |
| W9 | **`frontend-admin/**` + `backend-go/internal/admin`** |

- W2 saja `postJournal`
- W7 user checkout; W9 settings/catalog/CS
- W6 dilarang buat folder admin; W9 dilarang edit `frontend/`

---

## P0

1. Move FE existing → `frontend/`
2. Scaffold `frontend-admin/` (Vite React TS Tailwind, shell login + layout kosong)
3. Scaffold `backend/` (Hono Drizzle Redis)
4. Schema + seed (COA, plan_catalog, trial_days=90, platform admin)
6. CORS dual origin; healthcheck; root **`Makefile`** (`gen-secrets`, `gen-password`, `hash-password`, `env-backend`)
7. `docs/api.md`

---

## Workstream ringkas

- **W1–W5, W7:** auth seats, ledger, AR/AP, assets, reports, billing; trial dari `app_settings.trial_days`
- **W6 `frontend/`:** seluruh UI tenant; pricing fetch API; tanpa admin
- **W8 Mail + SaaS ops:** lihat bawah
- **W9 `frontend-admin/`:** UI monitoring + form trial/harga + CS actions; konsumsi `/api/platform/*`

### W8 — Email SMTP + SaaS ops (detail)

**Transport:** Nodemailer → `mail.fransiskus-richard.my.id`, from/user `admin@fransiskus-richard.my.id`.

**Modul:** `backend/src/modules/mail/` — `sendMail({ to, subject, html })`, queue sederhana (inline async dulu; gagal di-log, tidak gagalkan request utama).

**Template transactional (wajib v1):**

| Event | Pemicu |
|-------|--------|
| Welcome + trial aktif | Register |
| Invite anggota org | W1 invite create |
| Trial hampir habis (H-7, H-1) | Cron/job harian di backend |
| Trial habis → read-only | Job harian |
| Pembayaran sukses / gagal | Webhook Midtrans (W7 panggil mail) |
| Extend trial / set-plan oleh admin | W9 CS actions |
| License self-host diterbitkan | W9 issue license (kirim key ke email pembeli) |

W1/W7/W9 **hanya memanggil** `mail.send*`; tidak konfigurasi SMTP sendiri.

Juga tetap: banners in-app, usage meter, audit tenant, data export.

**Test:** `POST /api/platform/settings/test-email` (platform admin) kirim ke email admin untuk verifikasi SMTP.

---

## Ditunda

PPN e-Faktur, inventory/payroll, bank import, impersonation, SSO, 2FA admin (boleh menyusul setelah SMTP stabil).

---

## Prompt agent

- **W6:** “Hanya kerjakan `frontend/` (tenant). Jangan buat atau edit `frontend-admin/`.”
- **W9:** “Kerjakan `frontend-admin/` + `backend/src/modules/platform`. Jangan edit `frontend/` tenant.”
- **W7:** harga selalu dari `plan_catalog` DB; setelah webhook panggil mail sukses/gagal bayar.
- **W8:** “Implement `modules/mail` (SMTP env di atas) + templates + job trial reminder; ownership `saas`+`mail` saja.”
- **W1:** invite kirim email lewat `mail.sendInvite`.

---

## Deliverable akhir

1. Tiga app: `frontend`, `frontend-admin`, `backend`  
2. Akuntansi lengkap di tenant app  
3. Trial 90 hari default, editable dari admin app  
4. Harga/limit paket editable dari admin app; tenant pricing ikut DB  
5. Admin app pantau users/subs/events + extend/set-plan + license  
6. Cloud Midtrans + self-host  
7. Email transactional via SMTP `mail.fransiskus-richard.my.id` (from `admin@fransiskus-richard.my.id`)  
8. Root `Makefile` untuk generate password / bcrypt hash (Anda isi `.env` sendiri)  
9. `docs/PLAN.md` + README jalankan ketiga app
