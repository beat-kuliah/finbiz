import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../../lib/env.js";

let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    });
  }
  return transport;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(options: SendMailOptions): Promise<void> {
  await getTransport().sendMail({
    from: env.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html ?? options.text.replace(/\n/g, "<br>"),
  });
}

export async function sendWelcome(to: string, name: string): Promise<void> {
  await sendMail({
    to,
    subject: "Welcome to FinBiz",
    text: `Hi ${name},\n\nWelcome to FinBiz! Your account is ready.\n\n— FinBiz Team`,
  });
}

export async function sendInvite(
  to: string,
  orgName: string,
  inviteUrl: string,
): Promise<void> {
  await sendMail({
    to,
    subject: `You're invited to ${orgName} on FinBiz`,
    text: `You've been invited to join ${orgName} on FinBiz.\n\nAccept your invite: ${inviteUrl}`,
  });
}

export async function sendTrialReminder(
  to: string,
  name: string,
  daysLeft: number,
): Promise<void> {
  await sendMail({
    to,
    subject: "Your FinBiz trial is ending soon",
    text: `Hi ${name},\n\nYour FinBiz trial ends in ${daysLeft} day(s). Upgrade to keep full access.\n\n— FinBiz Team`,
  });
}

export async function sendPaymentResult(
  to: string,
  success: boolean,
  planName: string,
): Promise<void> {
  await sendMail({
    to,
    subject: success ? "Payment successful — FinBiz" : "Payment failed — FinBiz",
    text: success
      ? `Your payment for ${planName} was successful. Thank you!`
      : `We couldn't process your payment for ${planName}. Please try again.`,
  });
}

export async function sendTestEmail(to: string): Promise<void> {
  await sendMail({
    to,
    subject: "FinBiz test email",
    text: "This is a test email from FinBiz platform settings.",
  });
}
