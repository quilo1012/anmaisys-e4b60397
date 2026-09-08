import { afterEach, describe, expect, it } from "vitest";
import { ALL_ACTIONS, can, setIsOwner, setPermissionOverrides, type Action } from "@/lib/permissions";
import { deriveRoleRules } from "@/lib/roleRules";

/**
 * The Role rules page is only worth having if it derives what it shows. These assert the
 * derivation, not the markup: can + cannot are exact complements over ALL_ACTIONS, and
 * an override moves an action from one list to the other without anybody editing text.
 */
afterEach(() => { setPermissionOverrides({}); setIsOwner(false); });

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

describe("the page describes the role, not the reader", () => {
  it("does not let the owner bypass leak into the derivation", () => {
    const asAnyone = deriveRoleRules("operator");

    setIsOwner(true);
    const asOwner = deriveRoleRules("operator");
    for (const action of ["wo.force", "wo.delete", "stock.pricing"] as Action[]) {
      expect(asOwner.allowed).not.toContain(action);
      expect(asOwner.denied).toContain(action);
    }
    expect(asOwner.allowed.length).toBeLessThan(ALL_ACTIONS.length / 2);

    setIsOwner(false);
    expect(deriveRoleRules("operator")).toEqual(asAnyone);
    expect(asOwner).toEqual(asAnyone);
  });
});
