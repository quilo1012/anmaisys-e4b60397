// Shared option lists for the Quality Actions module (SafetyCulture-style).

export const QUALITY_LABELS = [
  "Batch code",
  "CCP",
  "Foreign Body",
  "GMP",
  "Health & Safety",
  "Label",
  "Maintenance",
  "Paperwork",
  "Office",
] as const;

export const QUALITY_DEPARTMENTS = ["Supervisor", "Quality", "Warehouse"] as const;

export interface QualityStatus {
  value: "todo" | "in_progress" | "complete";
  label: string;
  /** Tailwind classes for a badge. */
  badge: string;
  /** Chart colour. */
  color: string;
}

export const QUALITY_STATUSES: QualityStatus[] = [
  { value: "todo", label: "To do", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40", color: "hsl(38 92% 50%)" },
  { value: "in_progress", label: "In progress", badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40", color: "hsl(217 91% 60%)" },
  { value: "complete", label: "Complete", badge: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40", color: "hsl(142 76% 36%)" },
];

export function statusMeta(value: string | null | undefined): QualityStatus {
  return QUALITY_STATUSES.find((s) => s.value === value) ?? QUALITY_STATUSES[0];
}

export interface QualitySeverity {
  value: "low" | "medium" | "high" | "critical";
  label: string;
  /** Tailwind classes for a badge. */
  badge: string;
  /** Left-border accent class for Kanban cards. */
  accent: string;
  /** Weight used to score an action. Derived from severity — never stored. */
  points: number;
}

export const QUALITY_SEVERITIES: QualitySeverity[] = [
  { value: "low", label: "Low", badge: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/40", accent: "border-l-slate-400", points: 1 },
  { value: "medium", label: "Medium", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40", accent: "border-l-amber-400", points: 2 },
  { value: "high", label: "High", badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40", accent: "border-l-orange-500", points: 3 },
  { value: "critical", label: "Critical", badge: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40", accent: "border-l-red-500", points: 4 },
];

export function severityMeta(value: string | null | undefined): QualitySeverity | null {
  return QUALITY_SEVERITIES.find((s) => s.value === value) ?? null;
}

/**
 * Points for one action, derived from its severity. Points are NOT a stored
 * column: severity is the single source of truth, so re-grading an action can
 * never leave a stale score behind. An action with no severity scores 0.
 */
export function severityPoints(value: string | null | undefined): number {
  return severityMeta(value)?.points ?? 0;
}

/** Total points across a set of actions. */
export function sumSeverityPoints(actions: Array<{ severity: string | null }>): number {
  return actions.reduce((sum, a) => sum + severityPoints(a.severity), 0);
}
