package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a pgx connection pool.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if databaseURL == "" {
		return nil, errors.New("db: empty database URL")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}

func openMigrate(databaseURL, migrationsPath string) (*migrate.Migrate, error) {
	if databaseURL == "" {
		return nil, errors.New("db: empty database URL")
	}
	if migrationsPath == "" {
		return nil, errors.New("db: empty migrations path")
	}
	m, err := migrate.New("file://"+migrationsPath, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: migrate open: %w", err)
	}
	return m, nil
}

// Migrate applies all up migrations from migrationsPath using golang-migrate.
func Migrate(databaseURL, migrationsPath string) error {
	m, err := openMigrate(databaseURL, migrationsPath)
	if err != nil {
		return err
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("db: migrate up: %w", err)
	}
	return nil
}

// MigrateDown rolls back one migration.
func MigrateDown(databaseURL, migrationsPath string) error {
	m, err := openMigrate(databaseURL, migrationsPath)
	if err != nil {
		return err
	}
	defer m.Close()

	if err := m.Steps(-1); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("db: migrate down: %w", err)
	}
	return nil
}

// Force sets the migration version without running SQL (baseline existing schema).
func Force(databaseURL, migrationsPath string, version int) error {
	m, err := openMigrate(databaseURL, migrationsPath)
	if err != nil {
		return err
	}
	defer m.Close()
	if err := m.Force(version); err != nil {
		return fmt.Errorf("db: migrate force: %w", err)
	}
	return nil
}
