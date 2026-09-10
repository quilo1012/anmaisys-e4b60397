import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTIVE_ROLES, ALL_ACTIONS, defaultCan, type Action, type Role } from "@/lib/permissions";

/**
 * A route used to say who may enter twice: an `allowedRoles` list AND a `requiredAction`.
 * `ProtectedRoute` demanded both, so the two lists only had to disagree by one name for a
 * screen to be promised to somebody and then refused to them. /dashboard/line-production
 * was exactly that, and the only way to find out was to hold the role and be turned away.
 *
 * Since the profile model was fixed there is one list, not two: a gated route declares an
 * action and the matrix answers. What can still go wrong is smaller and is what this
 * checks — an action nobody holds (a dead screen), a misspelt action (silently ungated in
 * the type-free string), or a role name on the few `allowedRoles`-only routes that does
 * not exist.
 *
 * A route deliberately narrower than its permission is NOT an error: `/dashboard/users`
 * is admin-only while `manager` holds `users.manage` and reaches the same screen through
 * `/users/manage`.
 */

const APP = readFileSync(resolve(__dirname, "..", "App.tsx"), "utf8");

const PAPEIS: Role[] = [
  "admin", "engineer", "operator", "manager", "viewer", "maintenance_manager",
  "co_engineer", "supervisor", "planner", "warehouse", "quality_supervisor",
  "production_office_admin",
];

interface Rota { path: string; roles: Role[]; action: Action | null }

/** Every <Route> wrapped in a ProtectedRoute, with whichever gate it declares. */
function rotas(): Rota[] {
  const out: Rota[] = [];
  const re = /<Route\s+path="([^"]+)"\s+element=\{[\s\S]*?<ProtectedRoute([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(APP))) {
    const attrs = m[2];
    const ar = /allowedRoles=\{\[([^\]]*)\]\}/.exec(attrs);
    const ra = /requiredAction="([^"]+)"/.exec(attrs);
    if (!ar && !ra) continue;
    out.push({
      path: m[1],
      roles: ar ? [...ar[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1] as Role) : [],
      action: ra ? (ra[1] as Action) : null,
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

  it("never states the same gate twice", () => {
    // Both props together is the AND-lockout this whole file exists because of.
    const duplas = todas.filter((r) => r.action && r.roles.length).map((r) => r.path);
    expect(duplas).toEqual([]);
  });

  it("names an action the matrix knows", () => {
    // requiredAction is a plain string in the JSX, so a typo is not caught by the type
    // system and would gate the route on an action nobody can ever hold.
    const desconhecidas = todas
      .filter((r) => r.action && !(ALL_ACTIONS as string[]).includes(r.action))
      .map((r) => `${r.path}: ${r.action}`);
    expect(desconhecidas).toEqual([]);
  });

  it("names a role that exists", () => {
    const desconhecidos = todas.flatMap((r) =>
      r.roles.filter((p) => !PAPEIS.includes(p)).map((p) => `${r.path}: ${p}`),
    );
    expect(desconhecidos).toEqual([]);
  });

  it("can be entered by somebody who still has an account", () => {
    // A screen whose gate no live profile holds is dead to everyone but the owner.
    const inalcancaveis = todas
      .filter((r) =>
        r.action
          ? !ACTIVE_ROLES.some((papel) => defaultCan(papel, r.action as Action))
          : !r.roles.some((papel) => (ACTIVE_ROLES as readonly Role[]).includes(papel)),
      )
      .map((r) => `${r.path} (${r.action ?? r.roles.join("/")})`);
    expect(inalcancaveis).toEqual([]);
  });
});
