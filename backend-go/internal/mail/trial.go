package mail

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var reminderDays = []int{7, 3, 1}

var defaultMailer *Mailer

// Init sets the default mailer used by CheckTrialsAndNotify.
func Init(m *Mailer) {
	defaultMailer = m
}

// CheckTrialsAndNotify emails trial users who expire in 7/3/1 days.
func CheckTrialsAndNotify(ctx context.Context, pool *pgxpool.Pool) (notified int, err error) {
	return checkTrialsAndNotify(ctx, pool, defaultMailer)
}

func checkTrialsAndNotify(ctx context.Context, pool *pgxpool.Pool, mailer *Mailer) (notified int, err error) {
	if mailer == nil {
		return 0, nil
	}
	now := time.Now()

	for _, daysLeft := range reminderDays {
		target := now.AddDate(0, 0, daysLeft)
		dayStart := time.Date(target.Year(), target.Month(), target.Day(), 0, 0, 0, 0, target.Location())
		dayEnd := time.Date(target.Year(), target.Month(), target.Day(), 23, 59, 59, 999000000, target.Location())

		rows, qerr := pool.Query(ctx, `
			SELECT email, name FROM users
			WHERE plan = 'trial' AND trial_ends_at >= $1 AND trial_ends_at <= $2
		`, dayStart, dayEnd)
		if qerr != nil {
			return notified, qerr
		}

		for rows.Next() {
			var email, name string
			if scanErr := rows.Scan(&email, &name); scanErr != nil {
				rows.Close()
				return notified, scanErr
			}
			if sendErr := mailer.SendTrialReminder(email, name, daysLeft); sendErr != nil {
				log.Printf("Failed to send trial reminder to %s: %v", email, sendErr)
				continue
			}
			notified++
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return notified, err
		}
	}
	return notified, nil
}
