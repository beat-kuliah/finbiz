import { docStatusLabel, openItemStatusLabel, subscriptionStatusLabel } from "@/lib/labels";

type Tone = "ok" | "danger" | "warn" | "muted";

const toneClass: Record<Tone, string> = {
  ok: "bg-pine/15 text-pine-dark dark:text-pine",
  danger: "bg-red-500/15 text-red-600 dark:text-red-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  muted: "bg-sand/60 text-ink-muted",
};

function toneForDocStatus(status: string): Tone {
  if (status === "voided" || status === "canceled" || status === "cancelled") return "danger";
  if (status === "posted" || status === "active") return "ok";
  if (status === "draft" || status === "trial" || status === "past_due") return "warn";
  return "muted";
}

export function StatusBadge({
  status,
  label,
  variant = "doc",
}: {
  status: string;
  label?: string;
  variant?: "doc" | "openItem" | "subscription";
}) {
  const text =
    label ??
    (variant === "openItem"
      ? openItemStatusLabel(status)
      : variant === "subscription"
        ? subscriptionStatusLabel(status)
        : docStatusLabel(status));
  const tone = toneForDocStatus(status);
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>
      {text}
    </span>
  );
}
