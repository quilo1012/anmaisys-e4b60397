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
  /** Tailwind background for a 4px rule down the left of the card. */
  cls: string;
}

const ROLE_STRIPES: Array<RoleStripe & { match: RegExp }> = [
  { match: /supervisor/i,             label: "Supervisor",  cls: "bg-rose-500" },
  { match: /team\s*lead/i,            label: "Team Leader", cls: "bg-violet-500" },
  { match: /technician|maintenance/i, label: "Technician",  cls: "bg-sky-500" },
  { match: /lab|blender/i,            label: "Lab",         cls: "bg-teal-500" },
  { match: /quality/i,                label: "Quality",     cls: "bg-amber-500" },
  { match: /warehouse|wh\b/i,         label: "Warehouse",   cls: "bg-orange-500" },
  { match: /office|admin/i,           label: "Office",      cls: "bg-slate-400" },
];

/**
 * The stripe for a department, or null when it is not one of the named roles.
 *
 * First match wins, so the order above is the order of specificity: "Lab Operative"
 * has to be tested before anything that would also match "Operative".
 */
export function roleStripe(department: string | null | undefined): RoleStripe | null {
  if (!department) return null;
  const hit = ROLE_STRIPES.find((r) => r.match.test(department));
  return hit ? { label: hit.label, cls: hit.cls } : null;
}
