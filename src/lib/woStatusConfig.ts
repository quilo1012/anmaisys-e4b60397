/**
 * Single source of truth for Work Order status badges.
 *
 * Replaces the duplicated `statusConfig` maps that were scattered across
 * OperatorDashboard / EngineerDashboard / WorkOrdersPage. The previous
 * variants used `bg-blue-100 text-blue-800` style classes, which are
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
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  received: {
    label: "Received",
    className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  },
  arrived: {
    label: "Arrived",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  finished: {
    label: "Finished",
    className: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  },
  closed: {
    label: "Closed",
    className: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
  },
  completed: {
    label: "Completed",
    className: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
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
  high: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  low: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
};
