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

const ROLE_STRIPES: Array<RoleStripe & { match: RegExp }> = [
  { match: /supervisor/i,             label: "Supervisor",  short: "SUP",  cls: "bg-rose-500 text-white" },
  { match: /team\s*lead/i,            label: "Team Leader", short: "LEAD", cls: "bg-violet-500 text-white" },
  { match: /technician|maintenance/i, label: "Technician",  short: "TEC",  cls: "bg-sky-500 text-white" },
  { match: /lab|blender/i,            label: "Lab",         short: "LAB",  cls: "bg-teal-500 text-white" },
  { match: /quality/i,                label: "Quality",     short: "QA",   cls: "bg-amber-500 text-black" },
  { match: /warehouse|wh\b/i,         label: "Warehouse",   short: "WH",   cls: "bg-orange-500 text-white" },
  { match: /office|admin/i,           label: "Office",      short: "OFF",  cls: "bg-slate-500 text-white" },
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
  return hit ? { label: hit.label, short: hit.short, cls: hit.cls } : null;
}
