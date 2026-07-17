// Shared SLA targets (in minutes) — single source of truth for
// SLA compliance calculations across dashboards.
export const SLA_TARGETS: Record<string, number> = {
  low: 120,
  medium: 60,
  high: 30,
  critical: 10,
};
