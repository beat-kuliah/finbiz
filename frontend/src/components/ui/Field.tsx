import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export const controlClass =
  "w-full rounded-lg border border-sand bg-paper-card px-3 py-2.5 text-sm text-ink outline-none transition " +
  "placeholder:text-ink-faint hover:border-pine/40 " +
  "focus:border-pine focus:ring-2 focus:ring-pine/25";

export const labelClass = "mb-1.5 block text-sm font-medium text-ink-muted";

export function Field({
  label,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClass} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${controlClass} ${className}`} {...rest} />;
}

export function TextSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select className={`${controlClass} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-sand bg-paper-card p-4">
      {children}
    </div>
  );
}
