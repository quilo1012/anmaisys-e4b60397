import * as React from "react";
import { cn } from "@/lib/utils";
import { statusBadgeConfig } from "@/lib/design-tokens";

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
  if (normalized === "open") return "bg-blue-500";
  if (normalized === "in_progress" || normalized === "inprogress" || normalized === "progress") {
    return "bg-amber-500";
  }
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "finished" ||
    normalized === "closed" ||
    normalized === "finalized"
  ) {
    return "bg-green-500";
  }
  if (normalized === "cancelled" || normalized === "canceled") return "bg-gray-500";
  if (normalized === "pending" || normalized === "waiting" || normalized === "hold" || normalized === "on_hold") {
    return "bg-yellow-500";
  }
  if (normalized === "critical" || normalized === "high" || normalized === "urgent" || normalized === "error") {
    return "bg-red-500";
  }
  return "bg-gray-500";
}

export function StatusBadge({
  status,
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
      {status}
    </span>
  );
}

export default StatusBadge;
