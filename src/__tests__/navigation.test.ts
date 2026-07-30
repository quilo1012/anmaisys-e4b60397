import { describe, it, expect } from "vitest";
import { navItems } from "@/components/DashboardLayout";
import { can, type Role } from "@/lib/permissions";

/**
 * The sidebar's shape, asserted rather than assumed.
 *
 * Infrastructure lives under System and nowhere else. The risk is not that today's
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
  it("keeps infrastructure screens in the System group", () => {
    for (const title of SYSTEM_ONLY) {
      const item = navItems.find((i) => i.title === title);
      expect(item, `${title} is missing from the sidebar`).toBeTruthy();
      expect(item!.group).toBe("System");
    }
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
    const rendered = ["Overview", "Maintenance", "Assets", "Production", "Planning", "Reports", "Communication", "Administration", "System"];
    for (const item of navItems) {
      expect(rendered, `"${item.title}" is in group "${item.group}", which is never rendered`).toContain(item.group);
    }
  });
});
