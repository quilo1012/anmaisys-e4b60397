/**
 * The roles worth telling apart at a glance on the headcount board.
 *
 * A supervisor scanning a line wants to know it has a leader on it before they want
 * anybody's name. Matched with patterns rather than an enum because `department` was
 * typed by hand over months and holds "Technician Operator", "Lab Operative" and
 * "PRODUCTION" in the same column — an exact list would silently match nothing.
 *
 * Production is deliberately absent. It is most of the factory, and a colour that
 * every row carries tells the eye nothing.
 */
export interface RoleStripe {
  label: string;
  /** Two or three letters, because the label sits on a one-line card beside a name. */
  short: string;
  /** Solid fill and readable text on it, in both themes. */
  cls: string;
}

export interface RoleDisplayPerson {
  role?: string | null;
  position?: string | null;
  department?: string | null;
  /** Use only when the caller already knows the person came from this table. */
  source?: "employees" | "engineers";
}

const OPERATOR: RoleStripe = { label: "Operator", short: "OP", cls: "bg-primary text-primary-foreground" };
const ENGINEER: RoleStripe = { label: "Engineer", short: "ENG", cls: "bg-primary text-primary-foreground" };

const ROLE_STRIPES: Array<RoleStripe & { match: RegExp }> = [
  { match: /supervisor/i,             label: "Supervisor",  short: "SUP",  cls: "bg-destructive text-destructive-foreground" },
  { match: /team\s*lead/i,            label: "Team Leader", short: "LEAD", cls: "bg-primary text-primary-foreground" },
  { match: /technician|maintenance/i, label: "Technician",  short: "TEC",  cls: "bg-primary text-primary-foreground" },
  { match: /lab|blender/i,            label: "Lab",         short: "LAB",  cls: "bg-success text-success-foreground" },
  { match: /quality/i,                label: "Quality",     short: "QA",   cls: "bg-warning text-warning-foreground" },
  { match: /warehouse|wh\b/i,         label: "Warehouse",   short: "WH",   cls: "bg-warning text-warning-foreground" },
  { match: /office|admin/i,           label: "Office",      short: "OFF",  cls: "bg-muted-foreground text-background" },
];

/**
 * Shared display-only mapping for a role, position or existing person record.
 * Explicit operator/engineer identities take precedence over broad job patterns.
 * Other positions retain the existing first-match mapping and job-first fallback.
 *
 * First match wins, so the order above is the order of specificity: "Lab Operative"
 * has to be tested before anything that would also match "Operative".
 */
export function roleStripe(value: string | RoleDisplayPerson | null | undefined): RoleStripe | null {
  if (!value) return null;
  if (typeof value !== "string") {
    if (value.source === "engineers" || /^(engineer|maintenance_manager)$/i.test(value.role ?? "")) return { ...ENGINEER };
    if (/^operator$/i.test(value.role ?? "")) return { ...OPERATOR };
    return roleStripe(value.position) ?? roleStripe(value.department) ?? roleStripe(value.role);
  }
  const name = value.trim();
  if (/^(operator|technician\s+operator)$/i.test(name)) return { ...OPERATOR };
  if (/^(engineer|maintenance_manager)$/i.test(name) || /maintenance/i.test(name)) return { ...ENGINEER };
  const hit = ROLE_STRIPES.find((r) => r.match.test(name));
  return hit ? { label: hit.label, short: hit.short, cls: hit.cls } : null;
}
