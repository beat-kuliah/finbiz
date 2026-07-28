# FinBiz

Pembukuan double-entry multi-PT untuk UMKM — cloud SaaS + self-host.

## Struktur

```
finbiz/
  frontend/         # App pelanggan — http://localhost:5173
  frontend-admin/   # Platform admin — http://localhost:5174
  backend/          # API Hono — http://localhost:8080
  docs/PLAN.md
  Makefile
```

## Prasyarat

- Node.js 20+
- PostgreSQL (DB `finbiz`)
- Redis

Credential lokal default ada di `backend/.env.example`. Jika Postgres hanya socket Unix:

```env
PGHOST=/path/to/pgsql/run
PGDATABASE=finbiz
PGUSER=postgres
PGPASSWORD=Admin123
```

## Setup

```bash
# Secrets (opsional — tempel manual ke .env)
make gen-secrets
make env-backend

# Database
createdb finbiz   # atau CREATE DATABASE finbiz;

cd backend
npm install
npm run db:migrate
npm run db:seed
npm run dev

# Terminal lain
cd frontend && npm install && npm run dev
cd frontend-admin && npm install && npm run dev
```

## Akun seed

| App | Email | Password |
|-----|-------|----------|
| Platform admin | `admin@finbiz.local` | `Admin123` |
| Tenant | daftar via `/register` | trial 90 hari (editable di admin) |

## Makefile

| Command | Fungsi |
|---------|--------|
| `make gen-secrets` | Password acak Postgres/Redis/SMTP |
| `make gen-password` | Satu password acak |
| `make hash-password P='...'` | Bcrypt hash |
| `make env-backend` | Copy `.env.example` → `.env` jika belum ada |

SMTP: isi `SMTP_PASS` sendiri di `backend/.env` (mailbox `admin@fransiskus-richard.my.id`).

## Dokumentasi

- [docs/PLAN.md](docs/PLAN.md) — rencana produk & workstream
- [docs/api.md](docs/api.md) — referensi API
