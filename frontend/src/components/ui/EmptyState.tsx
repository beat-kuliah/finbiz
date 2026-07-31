import type { ReactNode } from "react";

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-muted py-4">{children}</p>;
}
