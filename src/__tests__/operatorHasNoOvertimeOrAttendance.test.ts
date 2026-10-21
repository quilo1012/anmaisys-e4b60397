import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { can } from "@/lib/permissions";
import { navItems, navItemShows } from "@/components/DashboardLayout";

/**
 * An operator signs in as before, but Overtime and Attendance are not theirs: not in the
 * menu, not behind a link typed by hand, and — BLOCO 113 — not in the database either.
 * Admin and manager keep everything.
 */
const SCREENS = ["/dashboard/my-overtime", "/dashboard/my-attendance", "/dashboard/my-work-area",
  "/dashboard/overtime", "/dashboard/attendance"];

describe("operator and overtime / attendance", () => {
  it("holds none of the four actions", () => {
    for (const a of ["overtime.respond", "overtime.manage", "attendance.view_own", "attendance.manage"] as const) {
      expect(can("operator", a), a).toBe(false);
    }
  });

  it("sees none of those screens in the menu, on any device", () => {
    for (const device of ["desktop", "tablet", "mobile"] as const) {
      const shown = navItems.filter((i) => navItemShows(i, "operator", device)).map((i) => i.url);
      for (const url of SCREENS) expect(shown, `${url} on ${device}`).not.toContain(url);
    }
  });

  it("every one of those routes is behind a permission an operator lacks", () => {
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    const guarded = SCREENS.filter((u) => app.includes(`path="${u}"`));
    expect(guarded.length).toBe(SCREENS.length);
    for (const url of guarded) {
      const at = app.indexOf(`path="${url}"`);
      const m = app.slice(at, at + 260).match(/requiredAction="([a-z_.]+)"/);
      expect(m, url).not.toBeNull();
      expect(can("operator", m![1] as never), `${url} needs ${m![1]}`).toBe(false);
    }
  });

  it("admin and manager keep their access", () => {
    for (const r of ["admin", "manager"] as const) {
      expect(can(r, "overtime.respond")).toBe(true);
      expect(can(r, "attendance.view_own")).toBe(true);
    }
  });

  it("the database agrees: my_employee_id() answers NULL without the permission", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261021160000_operators_have_no_overtime_or_attendance.sql"), "utf8");
    expect(sql).toMatch(/has_action\(auth\.uid\(\), 'overtime\.respond'/);
    expect(sql).toMatch(/has_action\(auth\.uid\(\), 'attendance\.view_own'/);
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/i);
  });
});
