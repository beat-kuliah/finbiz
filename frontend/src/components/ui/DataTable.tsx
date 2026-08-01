import type { ReactNode } from "react";

export function DataTable({
  headers,
  children,
  empty,
}: {
  headers: { label: string; align?: "left" | "right" }[];
  children: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-faint border-b border-sand">
            {headers.map((h) => (
              <th key={h.label} className={`py-2 ${h.align === "right" ? "text-right" : ""}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function DataRow({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const className = `border-b border-sand/70 ${onClick ? "cursor-pointer hover:bg-sand/40" : ""} ${active ? "bg-sand/50" : ""}`;
  if (onClick) {
    return (
      <tr className={className} onClick={onClick}>
        {children}
      </tr>
    );
  }
  return <tr className={className}>{children}</tr>;
}

export function Td({
  children,
  align = "left",
  mono,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  className?: string;
}) {
  return (
    <td className={`py-2 ${align === "right" ? "text-right" : ""} ${mono ? "font-mono" : ""} ${className}`}>
      {children}
    </td>
  );
}
