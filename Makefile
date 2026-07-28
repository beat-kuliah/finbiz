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
	@echo "# Untuk SMTP: SMTP_USER=admin@fransiskus-richard.my.id — isi SMTP_PASS dari panel mail."

hash-password:
	@test -n "$(P)" || (echo "Usage: make hash-password P='your-password'" && exit 1)
	@cd backend && node -e "import('bcryptjs').then(b=>b.hash('$(P)',10).then(console.log))"

env-backend:
	@test -f backend/.env.example || (echo "missing backend/.env.example" && exit 1)
	@if [ ! -f backend/.env ]; then cp backend/.env.example backend/.env && echo "Created backend/.env"; else echo "backend/.env already exists — not overwritten"; fi
