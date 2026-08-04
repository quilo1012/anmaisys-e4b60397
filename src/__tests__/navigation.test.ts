import { describe, it, expect } from "vitest";
import { navItems } from "@/components/DashboardLayout";
import { SYSTEM_TOOLS } from "@/pages/dashboard/SystemHubPage";
import { can, type Role } from "@/lib/permissions";

/**
 * The sidebar's shape, asserted rather than assumed.
 *
 * Infrastructure lives behind the System hub and nowhere else. The risk is not that today's
 * menu is wrong — it is that the next integration screen gets added with
 * `roles: ["admin", "manager"]` and quietly appears in a production manager's
 * sidebar. That is the failure these tests are here to catch.
 */

const SYSTEM_ONLY = [
  "Audit Logs",
  "iTouching Sync",
  "iTouching Machines",
  "iTouching Stop Codes",
  "Settings",
  "Root Diagnostics",
];

describe("sidebar", () => {
  it("keeps infrastructure screens in the System hub", () => {
    for (const title of SYSTEM_ONLY) {
      expect(
        SYSTEM_TOOLS.find((t) => t.title === title),
        `${title} is missing from the System hub`,
      ).toBeTruthy();
    }
  });

  it("keeps infrastructure screens out of the sidebar entirely", () => {
    // The point of the hub is one row, not eight. A screen quietly re-added to the
    // sidebar would undo it without anyone noticing.
    for (const title of SYSTEM_ONLY) {
      expect(
        navItems.find((i) => i.title === title),
        `${title} is back in the sidebar — it belongs in the System hub`,
      ).toBeFalsy();
    }
  });

  it("never defines a group holding a single item", () => {
    // A group of one costs a line of sidebar and a beat of reading and returns
    // nothing. That is what dissolved Assets, then Reports and Communication.
    //
    // Asserted on the group definitions, not on what a role ends up seeing: role
    // filtering shrinks a group of six down to one on its own — a planner sees a
    // single row under Maintenance — and no arrangement of this list can prevent it.
    //
    // System is the deliberate exception: its one row IS the hub, standing in for
    // eight screens. Administration likewise holds Users alone, for managers only.
    const counts = new Map<string, number>();
    for (const i of navItems) counts.set(i.group, (counts.get(i.group) ?? 0) + 1);
    for (const [group, n] of counts) {
      if (group === "System" || group === "Administration") continue;
      expect(n, `"${group}" is a heading over ${n} item — fold it into another group`).toBeGreaterThan(1);
    }
  });

  it("gives the System hub exactly one way in", () => {
    const entries = navItems.filter((i) => i.url === "/dashboard/system");
    expect(entries).toHaveLength(1);
    expect(entries[0].group).toBe("System");
  });

  it("leaves managers a route to Users without the rest of the hub", () => {
    // A manager can manage users and has no business in the audit trail or the
    // integration settings. Folding Users into the hub would have cost them the link
    // or handed them everything else with it.
    const users = navItems.filter((i) => i.url === "/users/manage");
    expect(users.some((i) => i.roles.includes("manager"))).toBe(true);
    expect(users.every((i) => i.group !== "System")).toBe(true);
  });

  it("shows nothing under System to anyone but an admin", () => {
    for (const item of navItems.filter((i) => i.group === "System")) {
      expect(item.roles, `${item.title} is offered to ${item.roles.join(", ")}`).toEqual(["admin"]);
    }
  });

  it("gates every item that names an action on that action", () => {
    // An item listing a role that the permission matrix denies would render a link
    // straight into an access-denied page.
    for (const item of navItems) {
      if (!item.action) continue;
      for (const role of item.roles) {
        expect(can(role as Role, item.action), `${role} sees "${item.title}" but is denied ${item.action}`).toBe(true);
      }
    }
  });

  it("puts every item in a group the sidebar actually renders", () => {
    // Assets was folded into Maintenance — an item left behind in a group the sidebar
    // no longer renders would simply vanish from the menu.
    const rendered = ["Overview", "Maintenance", "Production", "Planning", "Reports", "Communication", "Administration", "System"];
    for (const item of navItems) {
      expect(rendered, `"${item.title}" is in group "${item.group}", which is never rendered`).toContain(item.group);
    }
  });
});
