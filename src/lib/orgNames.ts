/**
 * One spelling per department, and job titles kept out of the department column.
 *
 * Both fields were free text, and 189 people had between them fifteen departments and
 * fifteen positions for what is really seven departments and eight jobs:
 *
 *     department: Production · Production Operative · Team Leader · Warehouse ·
 *                 Hygiene · Office Admin · Supervisor · Lab Operative ·
 *                 Technician Operator · Quality · Blender Room ·
 *                 Lab / Blender Room · Maintenance · Warehouse Operative
 *     position:   Prodcution Operative (22) · Prodcution (2) · Labe Operative (1) …
 *
 * Two separate faults. "Team Leader" is a job, not a department, so twenty people had
 * no department at all while appearing to have one — and any figure grouped by
 * department split them off from the line they actually work on. And the same job was
 * spelled three ways, so grouping by position counted "Prodcution Operative" and
 * "Production Operative" as different jobs.
 *
 * The seven names here are not invented: they are exactly what `headcount_areas.department`
 * already holds, which was clean all along. The board and the people list now use one
 * vocabulary, so a total can be taken across both.
 */

/** The departments this factory has. Same list as the headcount areas carry. */
export const DEPARTMENTS = [
  "Production",
  "Warehouse",
  "Hygiene",
  "Quality",
  "Maintenance",
  "Lab",
  "Office",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

/** The jobs people hold. A job is not a department, which is the mistake this fixes. */
export const POSITIONS = [
  "Production Operative",
  "Team Leader",
  "Supervisor",
  "Technician Operator",
  "Lab Operative",
  "Warehouse Operative",
  "Quality Control",
  "Office Admin",
] as const;

export type Position = (typeof POSITIONS)[number];

/** Everything seen in either column, folded onto one canonical name. */
const DEPARTMENT_ALIASES: Record<string, Department> = {
  "office admin": "Office",
  office: "Office",
  "blender room": "Production",
  "production operative": "Production",
  "technician operator": "Production",
  "warehouse operative": "Warehouse",
  "lab operative": "Lab",
  "lab / blender room": "Lab",
  laboratory: "Lab",
  wh: "Warehouse",
  "wh team": "Warehouse",
  cleaning: "Hygiene",
  qa: "Quality",
  qc: "Quality",
  engineering: "Maintenance",
};

const POSITION_ALIASES: Record<string, Position> = {
  // The typo that outnumbered the correct spelling: 22 rows against 4.
  "prodcution operative": "Production Operative",
  prodcution: "Production Operative",
  production: "Production Operative",
  operative: "Production Operative",
  "labe operative": "Lab Operative",
  "quality controller": "Quality Control",
  "shift supervisor": "Supervisor",
  "team lead": "Team Leader",
  leader: "Team Leader",
  warehouse: "Warehouse Operative",
  "blender room": "Production Operative",
};

const key = (raw: string) => raw.trim().replace(/\s+/g, " ").toLowerCase();

const exact = <T extends string>(list: readonly T[], k: string): T | null =>
  list.find((v) => v.toLowerCase() === k) ?? null;

/**
 * A typed department folded onto one of the seven, or null.
 *
 * Null rather than a guess, and null rather than the old text: a value nobody can
 * group by is worth less than an empty field that says so. A job title given as a
 * department returns null here — `normalisePosition` is where it belongs.
 */
export function normaliseDepartment(raw: string | null | undefined): Department | null {
  if (!raw) return null;
  const k = key(raw);
  if (!k) return null;
  return exact(DEPARTMENTS, k) ?? DEPARTMENT_ALIASES[k] ?? null;
}

/** A typed job title folded onto one of the known ones, or null. */
export function normalisePosition(raw: string | null | undefined): Position | null {
  if (!raw) return null;
  const k = key(raw);
  if (!k) return null;
  return exact(POSITIONS, k) ?? POSITION_ALIASES[k] ?? null;
}

/**
 * Department and job from the two fields together, whichever they were typed into.
 *
 * People put the job in the department box and the department in the job box, so both
 * are read for both. An explicit department wins over one inferred from a job title:
 * somebody recorded as Production who is a Lab Operative was put in Production on
 * purpose, and this is not the place to overrule that.
 */
export function normalisePerson(
  department: string | null | undefined,
  position: string | null | undefined,
): { department: Department | null; position: Position | null } {
  return {
    department: normaliseDepartment(department) ?? normaliseDepartment(position),
    position: normalisePosition(position) ?? normalisePosition(department),
  };
}
