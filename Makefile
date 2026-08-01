# Usage:
#   make gen-secrets          # cetak 3 password acak (postgres, redis, smtp)
#   make gen-password         # satu password acak
#   make hash-password P=...  # bcrypt hash (untuk seed PLATFORM_ADMIN_PASSWORD di DB)
#   make env-backend          # buat backend-go/.env dari .env.example jika belum ada

.PHONY: gen-secrets gen-password hash-password env-backend

gen-password:
	@openssl rand -base64 24 | tr -d '/+=' | head -c 32; echo

gen-secrets:
	@echo "POSTGRES_PASSWORD=$$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
	@echo "REDIS_PASSWORD=$$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
	@echo "SMTP_PASS=$$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
	@echo ""
	@echo "# Tempel manual ke backend-go/.env dan sesuaikan user Postgres/Redis di server."
	@echo "# Untuk SMTP: SMTP_USER=admin@fransiskus-richard.my.id — isi SMTP_PASS dari panel mail."

hash-password:
	@test -n "$(P)" || (echo "Usage: make hash-password P='your-password'" && exit 1)
	@cd backend-go && go run ./cmd/hashpassword "$(P)"

env-backend:
	@test -f backend-go/.env.example || (echo "missing backend-go/.env.example" && exit 1)
	@if [ ! -f backend-go/.env ]; then cp backend-go/.env.example backend-go/.env && echo "Created backend-go/.env"; else echo "backend-go/.env already exists — not overwritten"; fi
