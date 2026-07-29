# FinBiz Go backend
#
# Install golang-migrate CLI:
#   go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
#
# Ensure DATABASE_URL is set (copy .env.example → .env).

-include .env
export

.PHONY: migrate-up migrate-down migrate-force migrate-create seed run-api run-worker test tidy env

# golang-migrate via cmd/migrate (respects PGHOST unix socket via config.DatabaseURL).
# Optional CLI: go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

migrate-up:
	go run ./cmd/migrate up

migrate-down:
	go run ./cmd/migrate down

migrate-force:
	@test -n "$(VERSION)" || (echo "usage: make migrate-force VERSION=1" && exit 1)
	go run ./cmd/migrate force $(VERSION)

migrate-create:
	@test -n "$(NAME)" || (echo "usage: make migrate-create NAME=add_foo" && exit 1)
	migrate create -ext sql -dir db/migrations -seq $(NAME)

seed:
	go run ./cmd/seed

run-api:
	go run ./cmd/api

run-worker:
	go run ./cmd/worker

test:
	go test ./...

env:
	@test -f .env.example || (echo "missing .env.example" && exit 1)
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created backend-go/.env"; else echo "backend-go/.env already exists"; fi

tidy:
	go mod tidy
