import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { defaultCan, type Role } from "@/lib/permissions";

/**
 * The staff roster was readable by three roles that hold no HR permission at all.
 *
 * `employees_read_roster` and `esh_read_roster` named eight roles. Every screen that
 * reads those tables is gated by `workforce.view` or `headcount.view`, both admin-only,
 * so warehouse, quality_supervisor and maintenance_manager were on a list no screen
 * could act on — and there were four real accounts between them, against 227 employee
 * records with emails, departments, reporting lines and a free-text notes field.
 *
 * This test holds the two halves of that argument, so neither can quietly stop being
 * true: that the roster's readers all sit behind an admin-only permission, and that the
 * policy asks for that permission rather than listing roles.
 */

const SRC = resolve(__dirname, "..");
const MIGRATION_DIR = resolve(SRC, "..", "supabase/migrations");

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => /employees select by matrix/.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration narrows the employees select policy");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

function ficheiros(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return ficheiros(p);
    return /\.tsx?$/.test(e) && !/\.test\./.test(e) ? [p] : [];
  });
}

const PAPEIS: Role[] = [
  "admin", "engineer", "operator", "manager", "viewer", "maintenance_manager",
  "co_engineer", "supervisor", "planner", "warehouse", "quality_supervisor",
  "production_office_admin",
];

describe("the staff roster", () => {
  const sql = migration();

  it("is read behind an admin-only permission, which is what makes the narrowing safe", () => {
    // The load-bearing fact. If somebody widens workforce.view in the matrix, the policy
    // widens with it automatically — but this test then fails, so the change is a
    // decision somebody takes rather than a side effect they discover.
    const quemVe = PAPEIS.filter((r) => defaultCan(r, "workforce.view"));
    expect(quemVe).toEqual(["admin"]);
  });

  it("asks the matrix instead of naming roles", () => {
    for (const tabela of ["employees", "employee_shift_history"]) {
      expect(sql).toMatch(
        new RegExp(`CREATE POLICY "${tabela} select by matrix"[\\s\\S]*?has_action\\(auth\\.uid\\(\\), 'workforce\\.view'`),
      );
    }
  });

  it("drops the old policies rather than adding beside them", () => {
    // Policies OR together: leaving these in place would keep all eight roles reading.
    expect(sql).toMatch(/DROP POLICY IF EXISTS "employees_read_roster"/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "esh_read_roster"/);
  });

  it("leaves the attendance family alone", () => {
    // Those policies match `attendance.manage`, a permission that exists. Narrowing them
    // is a decision about whether attendance management should exist, not a leak.
    for (const t of ["attendance_days", "daily_allocations", "headcount_matrix", "leave_requests"]) {
      expect(sql).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON public\\.${t}`));
    }
  });

  it("has no reader of employees outside an HR-gated screen", () => {
    // The claim the whole change rests on: every file touching the table belongs to a
    // screen behind workforce.view or headcount.view. A new reader elsewhere means this
    // narrowing starts returning empty tables, and this is where that surfaces.
    const PERMITIDOS = [
      "hooks/useWorkforce.ts", "hooks/useHeadcount.ts",
      "pages/dashboard/PeoplePage.tsx", "pages/dashboard/LeavePage.tsx",
      "pages/dashboard/AttendancePage.tsx", "pages/dashboard/FinanceClosePage.tsx",
      "components/workforce/",
    ];
    const leitores = ficheiros(SRC)
      .filter((f) => /\.from\("employees"\)|useEmployees/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1))
      .filter((f) => !PERMITIDOS.some((p) => f.startsWith(p)));
    expect(leitores).toEqual([]);
  });
});
