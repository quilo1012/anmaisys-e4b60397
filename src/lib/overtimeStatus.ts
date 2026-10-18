import { AlertTriangle, CircleDashed, CheckCircle2, Clock, Check, Lock, XCircle } from "lucide-react";
import type { CalendarStatus } from "@/lib/overtimeCalendar";

/** Presentation only: the existing calendar states, not new stored statuses. */
export const OVERTIME_STATUS = {
  needs: { label: "Needs staffing", icon: AlertTriangle, badge: "error", edge: "border-l-destructive", ink: "text-destructive-strong", fill: "bg-destructive", surface: "border-destructive/30 bg-destructive/10 text-destructive-strong" },
  partial: { label: "Partially filled", icon: CircleDashed, badge: "warning", edge: "border-l-warning", ink: "text-warning-strong", fill: "bg-warning", surface: "border-warning/30 bg-warning/10 text-warning-strong" },
  full: { label: "Fully booked", icon: CheckCircle2, badge: "success", edge: "border-l-success", ink: "text-success-strong", fill: "bg-success", surface: "border-success/30 bg-success/10 text-success-strong" },
  in_progress: { label: "In progress", icon: Clock, badge: "info", edge: "border-l-primary", ink: "text-primary", fill: "bg-primary", surface: "border-primary/30 bg-primary/10 text-primary" },
  completed: { label: "Completed", icon: Check, badge: "default", edge: "border-l-muted-foreground", ink: "text-muted-foreground", fill: "bg-muted-foreground", surface: "border-border bg-muted text-muted-foreground" },
  closed: { label: "Closed", icon: Lock, badge: "default", edge: "border-l-border", ink: "text-muted-foreground", fill: "bg-muted-foreground", surface: "border-border bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", icon: XCircle, badge: "cancelled", edge: "border-l-destructive/40", ink: "text-destructive-strong/80", fill: "bg-destructive/40", surface: "border-destructive/20 bg-destructive/5 text-destructive-strong/80 line-through" },
} satisfies Record<CalendarStatus, { label: string; icon: typeof Check; badge: string; edge: string; ink: string; fill: string; surface: string }>;

export const CALENDAR_STATUS_LABEL = Object.fromEntries(Object.entries(OVERTIME_STATUS).map(([k, v]) => [k, v.label])) as Record<CalendarStatus, string>;
export const CALENDAR_STATUS_BADGE = Object.fromEntries(Object.entries(OVERTIME_STATUS).map(([k, v]) => [k, v.badge])) as Record<CalendarStatus, string>;