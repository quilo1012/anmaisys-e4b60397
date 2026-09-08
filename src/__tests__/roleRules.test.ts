import { afterEach, describe, expect, it } from "vitest";
import { ALL_ACTIONS, can, setPermissionOverrides, type Action } from "@/lib/permissions";
import { deriveRoleRules } from "@/lib/roleRules";

/**
 * The Role rules page is only worth having if it derives what it shows. These assert the
 * derivation, not the markup: can + cannot are exact complements over ALL_ACTIONS, and
 * an override moves an action from one list to the other without anybody editing text.
 */
afterEach(() => setPermissionOverrides({}));

describe("role rules derivation", () => {
  it("splits ALL_ACTIONS into exact complements", () => {
    const r = deriveRoleRules("operator");
    expect([...r.allowed, ...r.denied].sort()).toEqual([...ALL_ACTIONS].sort());
    expect(r.allowed.filter((a) => r.denied.includes(a))).toEqual([]);
    expect(r.allowed.every((a) => can("operator", a))).toBe(true);
    expect(r.denied.every((a) => !can("operator", a))).toBe(true);
  });

  it("follows an override from one list to the other", () => {
    const action: Action = "stock.manage";
    expect(deriveRoleRules("operator").denied).toContain(action);

    setPermissionOverrides({ [`operator:${action}`]: true });
    const after = deriveRoleRules("operator");
    expect(after.allowed).toContain(action);
    expect(after.denied).not.toContain(action);
    expect(after.customisedCount).toBe(1);
    expect(
      after.groups.find((g) => g.key === "stock")?.allowed.some((e) => e.action === action && e.customised),
    ).toBe(true);
  });

  it("marks a group the role holds nothing in", () => {
    const r = deriveRoleRules("viewer");
    const system = r.groups.find((g) => g.key === "system");
    expect(system?.noAccessAtAll).toBe(true);
  });
});
