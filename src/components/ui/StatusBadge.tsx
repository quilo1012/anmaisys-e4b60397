import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * As variantes viviam em `lib/design-tokens.ts`, um segundo sistema de design paralelo
 * ao `index.css`: hexes cravados, a marca declarada como sky-500, e escalas próprias de
 * tipo, espaço e raio que contradiziam os tokens. Nada disso era importado por ninguém
 * — só este mapa era — por isso o ficheiro saiu e o mapa veio para o seu único
 * consumidor. Um componente que possui as suas próprias variantes não deixa ninguém em
 * dúvida sobre qual dos dois sistemas manda.
 *
 * As cores passam a descer dos tokens. O distintivo deixa de ser um comprimido de cor
 * cheia a competir com os dados: fica um fundo a 10%, uma hairline e o texto na
 * variante forte, que é a que se lê.
 */
const statusBadgeConfig = {
  open: "border border-primary/25 bg-primary/10 text-primary",
  in_progress: "border border-warning/30 bg-warning/10 text-warning-strong",
  completed: "border border-success/30 bg-success/10 text-success-strong",
  cancelled: "border border-border bg-muted text-muted-foreground",
  pending: "border border-warning/30 bg-warning/10 text-warning-strong",
  critical: "border border-destructive/30 bg-destructive/10 text-destructive-strong",
  success: "border border-success/30 bg-success/10 text-success-strong",
  warning: "border border-warning/30 bg-warning/10 text-warning-strong",
  error: "border border-destructive/30 bg-destructive/10 text-destructive-strong",
  info: "border border-primary/25 bg-primary/10 text-primary",
  low_stock: "border border-destructive/30 bg-destructive/10 text-destructive-strong",
  normal: "border border-success/30 bg-success/10 text-success-strong",
  default: "border border-border bg-muted text-muted-foreground",
} as const;

export type StatusBadgeVariant = keyof typeof statusBadgeConfig;

export interface StatusBadgeProps {
  /** Status value to display (case-insensitive). */
  status: string;
  /** Optional label override. Defaults to the status string. */
  label?: React.ReactNode;
  /** Size variant of the badge. */
  size?: "sm" | "md";
  /** Whether to show a colored dot icon before the label. */
  showIcon?: boolean;
  /** Optional additional className. */
  className?: string;
}

function normalizeStatus(status: string): string {
  return status
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function getStatusClasses(status: string): string {
  const normalized = normalizeStatus(status);

  if (normalized === "open" || normalized === "opened") {
    return statusBadgeConfig.open;
  }
  if (normalized === "in_progress" || normalized === "inprogress" || normalized === "progress") {
    return statusBadgeConfig.in_progress;
  }
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "finished" ||
    normalized === "closed" ||
    normalized === "finalized"
  ) {
    return statusBadgeConfig.completed;
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return statusBadgeConfig.cancelled;
  }
  if (
    normalized === "pending" ||
    normalized === "waiting" ||
    normalized === "hold" ||
    normalized === "on_hold"
  ) {
    return statusBadgeConfig.pending;
  }
  if (
    normalized === "critical" ||
    normalized === "high" ||
    normalized === "urgent" ||
    normalized === "error" ||
    normalized === "active" ||
    normalized === "low" ||
    normalized === "low_stock"
  ) {
    return statusBadgeConfig.critical;
  }
  if (
    normalized === "success" ||
    normalized === "ok" ||
    normalized === "normal" ||
    normalized === "resolved" ||
    normalized === "healthy"
  ) {
    return statusBadgeConfig.success;
  }
  if (normalized === "warning") return statusBadgeConfig.warning;
  if (normalized === "info") return statusBadgeConfig.info;

  return statusBadgeConfig.default;
}

function getDotColor(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === "open") return "bg-primary";
  if (normalized === "in_progress" || normalized === "inprogress" || normalized === "progress") {
    return "bg-warning";
  }
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "finished" ||
    normalized === "closed" ||
    normalized === "finalized"
  ) {
    return "bg-success";
  }
  if (normalized === "cancelled" || normalized === "canceled") return "bg-muted-foreground";
  if (normalized === "pending" || normalized === "waiting" || normalized === "hold" || normalized === "on_hold") {
    return "bg-warning";
  }
  if (normalized === "critical" || normalized === "high" || normalized === "urgent" || normalized === "error") {
    return "bg-destructive";
  }
  return "bg-muted-foreground";
}

export function StatusBadge({
  status,
  label,
  size = "md",
  showIcon = false,
  className,
}: StatusBadgeProps) {
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-xs";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold",
        getStatusClasses(status),
        sizeClasses,
        className,
      )}
    >
      {showIcon && (
        <span className={cn("h-1.5 w-1.5 rounded-full", getDotColor(status))} aria-hidden="true" />
      )}
      {label ?? status}
    </span>
  );
}

export default StatusBadge;
