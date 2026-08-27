import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, type Action, type Role } from "@/lib/permissions";

/**
 * A role listed on a route that the matrix does not grant is a promise the app cannot keep.
 *
 * `ProtectedRoute` requires BOTH: the role must be in `allowedRoles` AND `can(role,
 * action)` must be true. So a role named on the route but missing from the matrix is
 * refused anyway — the list says one thing and the app does another, and the only way to
 * find out is to hold that role and be turned away.
 *
 * /dashboard/line-production carried `engineer` and `co_engineer` for exactly that
 * reason. Neither holds `production.manage`, and the RLS on production_sessions and
 * production_items does not name them either, so even granting it would have produced a
 * screen that loads and refuses to save. Three places already agreed; only the route
 * disagreed.
 *
 * This checks all of them, because one route being wrong is a typo and the next one will
 * be too.
 *
 * THE OTHER DIRECTION IS NOT AN ERROR and is not checked: a role that holds the action
 * but is absent from `allowedRoles` is a route deliberately narrower than the
 * permission — `/dashboard/users` is admin-only while `manager` holds `users.manage`
 * and reaches the same screen through `/users/manage`. That is a decision, not a slip.
 */

const APP = readFileSync(resolve(__dirname, "..", "App.tsx"), "utf8");

const PAPEIS: Role[] = [
  "admin", "engineer", "operator", "manager", "viewer", "maintenance_manager",
  "co_engineer", "supervisor", "planner", "warehouse", "quality_supervisor",
  "production_office_admin",
];

interface Rota { path: string; roles: Role[]; action: Action }

/** Every <Route> whose ProtectedRoute carries both an allowedRoles list and an action. */
function rotas(): Rota[] {
  const out: Rota[] = [];
  const re = /<Route\s+path="([^"]+)"\s+element=\{[\s\S]*?<ProtectedRoute([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(APP))) {
    const attrs = m[2];
    const ar = /allowedRoles=\{\[([^\]]*)\]\}/.exec(attrs);
    const ra = /requiredAction="([^"]+)"/.exec(attrs);
    if (!ar || !ra) continue;
    out.push({
      path: m[1],
      roles: [...ar[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1] as Role),
      action: ra[1] as Action,
    });
  }
  return out;
}

describe("every protected route", () => {
  const todas = rotas();

  it("is found by the parser at all", () => {
    // A regex that stops matching turns every assertion below into a pass.
    expect(todas.length).toBeGreaterThan(30);
    expect(todas.map((r) => r.path)).toContain("/dashboard/line-production");
  });

  it("lists only roles the matrix actually grants the action to", () => {
    const mentiras = todas.flatMap((r) =>
      r.roles
        .filter((papel) => !defaultCan(papel, r.action))
        .map((papel) => `${r.path} lists ${papel} but the matrix denies ${r.action}`),
    );
    expect(mentiras).toEqual([]);
  });

  it("names a role that exists", () => {
    // A typo in a role name fails open in the worst way: the string is simply never
    // matched, so the route silently admits nobody by that name and no type catches it,
    // because allowedRoles is written inline.
    const desconhecidos = todas.flatMap((r) =>
      r.roles.filter((p) => !PAPEIS.includes(p)).map((p) => `${r.path}: ${p}`),
    );
    expect(desconhecidos).toEqual([]);
  });

  it("can be entered by somebody", () => {
    // The degenerate case the two checks above would both pass: a route whose role list
    // and whose action have no role in common at all. Nobody but an owner gets in, and
    // the screen is effectively dead.
    const inalcancaveis = todas
      .filter((r) => !r.roles.some((papel) => defaultCan(papel, r.action)))
      .map((r) => `${r.path} (${r.action})`);
    expect(inalcancaveis).toEqual([]);
  });
});
