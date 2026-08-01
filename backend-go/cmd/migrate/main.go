package main

import (
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/icus/finbiz/backend-go/internal/config"
	"github.com/icus/finbiz/backend-go/internal/db"
)

func main() {
	cfg := config.MustLoad()
	dir := "db/migrations"
	url := cfg.DatabaseURL()

	cmd := "up"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	switch cmd {
	case "up":
		if err := db.Migrate(url, dir); err != nil {
			log.Fatal(err)
		}
		fmt.Println("migrate up: ok")
	case "down":
		if err := db.MigrateDown(url, dir); err != nil {
			log.Fatal(err)
		}
		fmt.Println("migrate down: ok")
	case "force":
		if len(os.Args) < 3 {
			log.Fatal("usage: migrate force <version>")
		}
		v, err := strconv.Atoi(os.Args[2])
		if err != nil {
			log.Fatalf("invalid version: %v", err)
		}
		if err := db.Force(url, dir, v); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("migrate force %d: ok\n", v)
	default:
		log.Fatalf("usage: migrate [up|down|force <version>]")
	}
}
