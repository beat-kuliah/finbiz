# FinBiz

Pembukuan double-entry multi-PT untuk UMKM — cloud SaaS + self-host.

## Struktur

```
finbiz/
  frontend/              # App pelanggan — http://localhost:5173
  frontend-admin/        # Platform admin — http://localhost:5174
  backend-go/            # API Go (Chi) — http://localhost:8080
  backend-ts-archive/    # Backend Hono/TS lama (arsip)
  docs/PLAN.md
  Makefile
```

## Prasyarat

- Go 1.22+
- Node.js 20+ (frontend saja)
- PostgreSQL (DB `finbiz`)
- Redis

Credential lokal default ada di `backend-go/.env.example`. Jika Postgres hanya socket Unix:

```env
PGHOST=/path/to/pgsql/run
PGDATABASE=finbiz
PGUSER=postgres
PGPASSWORD=Admin123
```

Migrasi memakai **golang-migrate** (`db/migrations/`).

## Setup

```bash
# Secrets (opsional — tempel manual ke .env)
make gen-secrets
make env-backend

# Database
createdb finbiz   # atau CREATE DATABASE finbiz;

cd backend-go
make migrate-up   # golang-migrate via cmd/migrate
make seed
make run-api      # :8080

# Terminal lain — worker (trial reminder email)
cd backend-go && make run-worker

# Frontend
cd frontend && npm install && npm run dev
cd frontend-admin && npm install && npm run dev
```

Jika schema sudah ada dari migrasi Drizzle lama (arsip TS), baseline dulu:

```bash
cd backend-go
go run ./cmd/migrate force 1
make migrate-up
make seed
```

## Akun seed

| App | Email | Password |
|-----|-------|----------|
| Platform admin | `admin@finbiz.local` | `Admin123` |
| Tenant | daftar via `/register` | trial 90 hari (editable di admin) |

---

## Frontend pelanggan (`frontend/`)

App tenant untuk pembukuan bisnis. URL: http://localhost:5173

### Halaman publik & alur awal

| Halaman | Path | Fungsi |
|---------|------|--------|
| Landing | `/` | Halaman pemasaran produk |
| Login | `/login` | Masuk akun (email/password atau Google) |
| Register | `/register` | Daftar akun baru (trial otomatis) |
| Onboarding | `/onboarding` | Buat bisnis pertama: nama, jenis usaha (UMKM/dagang/jasa), saldo kas awal; men-seed bagan akun standar |

Setelah login, pengguna memilih **bisnis aktif** di sidebar (multi-PT). Semua menu di bawah beroperasi pada bisnis yang dipilih.

### Menu sidebar — Operasi

| Menu | Path | Fungsi |
|------|------|--------|
| Beranda | `/dashboard` | Ringkasan periode: kas, pendapatan, laba bersih, piutang, hutang, ekuitas. Jika owner punya lebih dari satu PT, menampilkan agregat konsolidasi |
| Transaksi | `/transactions` | Catat kas masuk, kas keluar, atau transfer antar akun kas. Setiap transaksi langsung memposting jurnal double-entry |
| Kas | `/cash` | Lihat daftar akun kas & bank beserta saldo |
| Kontak | `/contacts` | Kelola master data pelanggan, supplier, pemberi pinjaman, dan kontak lain |

### Menu sidebar — Keuangan

| Menu | Path | Fungsi |
|------|------|--------|
| Modal | `/capital` | Setor modal atau prive (tarik modal) |
| Hutang | `/payables` | Terima hutang/pinjaman (membuat saldo terbuka) dan bayar hutang terhadap open item |
| Piutang | `/receivables` | Catat invoice/piutang dan terima pelunasan terhadap open item |
| Aset tetap | `/assets` | Tambah aset (nilai perolehan, masa manfaat, residu), jalankan penyusutan bulanan, dan dispose aset |

### Menu sidebar — Laporan & akun

| Menu | Path | Fungsi |
|------|------|--------|
| Bagan akun | `/accounts` | Lihat chart of accounts bisnis (kode, nama, tipe, saldo) |
| Jurnal | `/journals` | Daftar jurnal yang terposting, detail baris debit/kredit, dan void jurnal |
| Laporan | `/reports` | Laba rugi (rentang tanggal), neraca, dan neraca saldo |
| Langganan | `/billing` | Status paket/trial, penggunaan (jumlah bisnis & kursi), daftar paket, dan checkout berlangganan |

### Pengaturan & utilitas

| Menu | Path | Fungsi |
|------|------|--------|
| Pengaturan | `/settings` | Ganti tema (terang/gelap) dan bahasa UI (ID/EN) |
| Tema (sidebar) | — | Toggle cepat terang/gelap |
| Keluar | — | Logout dan kembali ke login |

Navigasi mobile: bottom bar (Beranda, Transaksi, Laporan, Lainnya → bagan akun, Pengaturan).

---

## Frontend admin (`frontend-admin/`)

Panel platform admin untuk mengelola SaaS. URL: http://localhost:5174

| Menu | Path | Fungsi |
|------|------|--------|
| Ringkasan | `/` | Statistik platform: jumlah pengguna, langganan, event billing, lisensi, hari trial default |
| Pengguna | `/users` | Daftar tenant; perpanjang trial; ubah paket langganan pengguna |
| Paket | `/plans` | Edit paket SaaS: nama, harga bulanan/tahunan, max bisnis, max kursi, status aktif |
| Lisensi | `/licenses` | Terbitkan lisensi self-host (tier, email penerima, seats, masa berlaku) |
| Pengaturan | `/settings` | Tema dan bahasa panel admin |
| Keluar | — | Logout admin |

Login admin: `/login` (akun seed `admin@finbiz.local`).

---

## Makefile (root)

| Command | Fungsi |
|---------|--------|
| `make gen-secrets` | Password acak Postgres/Redis/SMTP |
| `make gen-password` | Satu password acak |
| `make hash-password P='...'` | Bcrypt hash |
| `make env-backend` | Copy `backend-go/.env.example` → `.env` jika belum ada |

## Makefile (`backend-go/`)

| Command | Fungsi |
|---------|--------|
| `make migrate-up` / `migrate-down` | golang-migrate |
| `make seed` | Plans + platform admin |
| `make run-api` / `run-worker` | Jalankan binary |
| `make test` | Unit tests |

SMTP: isi `SMTP_PASS` sendiri di `backend-go/.env` (mailbox `admin@fransiskus-richard.my.id`).

## Dokumentasi

- [docs/PLAN.md](docs/PLAN.md) — rencana produk & workstream
- [docs/api.md](docs/api.md) — referensi API
