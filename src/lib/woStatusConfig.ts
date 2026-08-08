/**
 * Single source of truth for Maintenance Order status badges.
 *
 * Replaces the duplicated `statusConfig` maps that were scattered across
 * OperatorDashboard / EngineerDashboard / WorkOrdersPage. The previous
 * variants used `bg-primary/10 text-primary` style classes, which are
 * unreadable on the dark theme (light text on near-white bg). These
 * use `<color>-500/15` tinted bg + `<color>-700 dark:<color>-300` text
 * for WCAG-AA contrast in both themes.
 */
export type WoStatus =
  | "open"
  | "received"
  | "arrived"
  | "in_progress"
  | "finished"
  | "closed"
  | "completed"
  | "force_closed";

export interface WoStatusEntry {
  label: string;
  className: string;
}

export const woStatusConfig: Record<string, WoStatusEntry> = {
  open: {
    label: "Open",
    className: "bg-primary/15 text-primary border-primary/30",
  },
  received: {
    label: "Received",
    className: "bg-primary/15 text-primary border-primary/30",
  },
  arrived: {
    label: "Arrived",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-warning/15 text-warning-strong border-warning/30",
  },
  finished: {
    label: "Finished",
    className: "bg-success/15 text-success-strong border-success/30",
  },
  closed: {
    label: "Closed",
    className: "bg-success/15 text-success-strong border-success/30",
  },
  completed: {
    label: "Completed",
    className: "bg-success/15 text-success-strong border-success/30",
  },
  force_closed: {
    label: "Force Closed",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function getWoStatusConfig(status: string | null | undefined): WoStatusEntry {
  if (!status) return { label: "—", className: "bg-muted text-muted-foreground border-border" };
  return woStatusConfig[status] ?? { label: status, className: "bg-muted text-muted-foreground border-border" };
}

/**
 * Priority chip colors (also dark-mode-safe). Used by the operator
 * "auto priority" preview chip and elsewhere.
 */
export const priorityChipClass: Record<string, string> = {
  high: "bg-destructive/15 text-destructive-strong border-destructive/30",
  medium: "bg-warning/15 text-warning-strong border-warning/30",
  low: "bg-success/15 text-success-strong border-success/30",
};
