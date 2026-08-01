package mail

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"

	"github.com/icus/finbiz/backend-go/internal/config"
)

// Mailer sends email via SMTP.
type Mailer struct {
	cfg *config.Config
}

// New constructs a Mailer from config.
func New(cfg *config.Config) *Mailer {
	return &Mailer{cfg: cfg}
}

// SendMailOptions is the payload for SendMail.
type SendMailOptions struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// SendMail sends an email using SMTP (STARTTLS when not secure).
func (m *Mailer) SendMail(opts SendMailOptions) error {
	if m.cfg == nil || m.cfg.SMTPHost == "" {
		return fmt.Errorf("mail: SMTP not configured")
	}
	from := m.cfg.SMTPFrom
	if from == "" {
		from = m.cfg.SMTPUser
	}
	html := opts.HTML
	if html == "" {
		html = strings.ReplaceAll(opts.Text, "\n", "<br>")
	}

	addr := fmt.Sprintf("%s:%d", m.cfg.SMTPHost, m.cfg.SMTPPort)
	msg := buildMessage(from, opts.To, opts.Subject, opts.Text, html)

	var auth smtp.Auth
	if m.cfg.SMTPUser != "" && m.cfg.SMTPPass != "" {
		auth = smtp.PlainAuth("", m.cfg.SMTPUser, m.cfg.SMTPPass, m.cfg.SMTPHost)
	}

	if m.cfg.SMTPSecure {
		return sendTLS(addr, m.cfg.SMTPHost, auth, from, opts.To, msg)
	}
	return sendStartTLS(addr, m.cfg.SMTPHost, auth, from, opts.To, msg)
}

func buildMessage(from, to, subject, text, html string) []byte {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: multipart/alternative; boundary=finbizboundary\r\n")
	b.WriteString("\r\n")
	b.WriteString("--finbizboundary\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	b.WriteString(text)
	b.WriteString("\r\n")
	b.WriteString("--finbizboundary\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	b.WriteString(html)
	b.WriteString("\r\n")
	b.WriteString("--finbizboundary--\r\n")
	return []byte(b.String())
}

func sendStartTLS(addr, host string, auth smtp.Auth, from, to string, msg []byte) error {
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return err
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsConfig := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
		if err := client.StartTLS(tlsConfig); err != nil {
			return err
		}
	}
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(extractEmail(from)); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func sendTLS(addr, host string, auth smtp.Auth, from, to string, msg []byte) error {
	tlsConfig := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		return err
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()

	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(extractEmail(from)); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func extractEmail(from string) string {
	if i := strings.LastIndex(from, "<"); i >= 0 {
		if j := strings.LastIndex(from, ">"); j > i {
			return strings.TrimSpace(from[i+1 : j])
		}
	}
	return strings.TrimSpace(from)
}

// SendWelcome sends a welcome email.
func (m *Mailer) SendWelcome(to, name string) error {
	return m.SendMail(SendMailOptions{
		To:      to,
		Subject: "Welcome to FinBiz",
		Text:    fmt.Sprintf("Hi %s,\n\nWelcome to FinBiz! Your account is ready.\n\n— FinBiz Team", name),
	})
}

// SendTrialReminder sends a trial ending reminder.
func (m *Mailer) SendTrialReminder(to, name string, daysLeft int) error {
	return m.SendMail(SendMailOptions{
		To:      to,
		Subject: "Your FinBiz trial is ending soon",
		Text: fmt.Sprintf(
			"Hi %s,\n\nYour FinBiz trial ends in %d day(s). Upgrade to keep full access.\n\n— FinBiz Team",
			name, daysLeft,
		),
	})
}

// SendTestEmail sends a platform settings test email.
func (m *Mailer) SendTestEmail(to string) error {
	return m.SendMail(SendMailOptions{
		To:      to,
		Subject: "FinBiz test email",
		Text:    "This is a test email from FinBiz platform settings.",
	})
}

// SendPaymentResult notifies the user of payment success/failure.
func (m *Mailer) SendPaymentResult(to string, success bool, planName string) error {
	subject := "Payment failed — FinBiz"
	text := fmt.Sprintf("We couldn't process your payment for %s. Please try again.", planName)
	if success {
		subject = "Payment successful — FinBiz"
		text = fmt.Sprintf("Your payment for %s was successful. Thank you!", planName)
	}
	return m.SendMail(SendMailOptions{To: to, Subject: subject, Text: text})
}

// SendInvite emails an organization invite link.
func (m *Mailer) SendInvite(to, orgName, inviteURL, role string) error {
	return m.SendMail(SendMailOptions{
		To:      to,
		Subject: fmt.Sprintf("You're invited to %s on FinBiz", orgName),
		Text: fmt.Sprintf(
			"You've been invited to join %s as %s.\n\nAccept the invite:\n%s\n\n— FinBiz Team",
			orgName, role, inviteURL,
		),
		HTML: fmt.Sprintf(
			"<p>You've been invited to join <strong>%s</strong> as <strong>%s</strong>.</p>"+
				`<p><a href="%s">Accept invite</a></p><p>— FinBiz Team</p>`,
			orgName, role, inviteURL,
		),
	})
}

// SendPasswordReset emails a password reset link.
func (m *Mailer) SendPasswordReset(to, resetURL string) error {
	return m.SendMail(SendMailOptions{
		To:      to,
		Subject: "Reset your FinBiz password",
		Text: fmt.Sprintf(
			"Reset your FinBiz password using this link (valid for 1 hour):\n\n%s\n\nIf you did not request this, ignore this email.\n\n— FinBiz Team",
			resetURL,
		),
		HTML: fmt.Sprintf(
			`<p>Reset your FinBiz password (valid for 1 hour):</p><p><a href="%s">Reset password</a></p>`+
				`<p>If you did not request this, ignore this email.</p><p>— FinBiz Team</p>`,
			resetURL,
		),
	})
}
