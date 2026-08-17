import { describe, it, expect } from "vitest";
import { navItems } from "@/components/DashboardLayout";
import { SYSTEM_TOOLS } from "@/pages/dashboard/SystemHubPage";
import { can, ALL_ROLES, type Role } from "@/lib/permissions";

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

  it("keeps Production in reading order, week to shift to exception", () => {
    // The sidebar renders items in array order, so the order IS the file order —
    // an item appended to the end of navItems lands at the bottom of its group.
    // Headcount spent a release declared among the admin screens for exactly that
    // reason, and read as an afterthought under Production.
    const order = navItems.filter((i) => i.group === "Production").map((i) => i.title);
    expect(order).toEqual([
      "RAG Weekly",
      "Leader scorecard",
      "Performance",
      "SKU Products",
      "Production Control",
      "Quality",
      "Headcount",
    ]);
  });

  it("puts the leader scorecard behind scorecard.fill", () => {
    expect(can("manager", "scorecard.fill")).toBe(true);
    expect(can("operator", "scorecard.fill")).toBe(false);
  });

  it("gives no two adjacent rows the same icon", () => {
    // Two Gauges in a row under Production meant the icon column stopped
    // distinguishing anything — the eye had to fall back to reading every label.
    //
    // Asserted per role, on the rows that role actually sees together: the three
    // Dashboard entries share LayoutDashboard by design and are never rendered
    // side by side, because their role sets are disjoint.
    for (const role of ALL_ROLES) {
      const groups = new Map<string, typeof navItems>();
      for (const i of navItems.filter((i) => (i.roles as string[]).includes(role))) {
        groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
      }
      for (const [group, items] of groups) {
        for (let n = 1; n < items.length; n++) {
          expect(
            items[n].icon,
            `a ${role} sees "${items[n - 1].title}" and "${items[n].title}" sharing an icon in ${group}`,
          ).not.toBe(items[n - 1].icon);
        }
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

  it("offers the line leader their own scorecard from the operator sidebar", () => {
    // The leader standing at the tablet is not the account it is signed in as. Their
    // only way to their own card used to be a button halfway down the operator panel,
    // in the header of the maintenance-orders card — reachable only by scrolling past
    // the form, on the one screen whose whole job is the form.
    const item = navItems.find((i) => i.url === "/dashboard/leader/scorecard");
    expect(item, "the leader scorecard is not in the sidebar at all").toBeTruthy();
    expect(item!.roles).toEqual(["operator"]);
  });

  it("leaves the leader scorecard ungated by the permission matrix", () => {
    // Every other operator row names an action and is filtered on can(). This one
    // cannot: line leaders have no account here — leader_pins is a name and a PIN
    // hash — and the tablet is signed in as its line rather than as a person, so
    // there is no role the matrix could answer for. The route is deliberately open
    // for the same reason (App.tsx), and the gate is the PIN, checked in the
    // database by leader_self_scorecard. An action added here would hide the link
    // from the only people it is for.
    const item = navItems.find((i) => i.url === "/dashboard/leader/scorecard");
    expect(item!.action).toBeUndefined();
  });

  it("keeps the leader scorecard within the operator's first three rows", () => {
    // On a phone the sidebar is a drawer and the bottom bar is the menu — and the bar
    // renders filteredItems.slice(0, 3). A fourth row here is not a smaller link, it
    // is one behind a hamburger. The leader has a phone or a tablet in their hand.
    const operatorItems = navItems.filter((i) => i.roles.includes("operator"));
    const titles = operatorItems.slice(0, 3).map((i) => i.title);
    expect(titles, "My Scorecard dropped out of the mobile tab bar").toContain("My Scorecard");
  });

  it("gives every bottom-bar row a label that fits without truncating", () => {
    // The tab bar caps each label at max-w-[68px] with `truncate`, which at text-2xs
    // holds about eleven characters — measured in Chromium at 390px, not guessed. Over
    // that, the row renders as "My Produc…" and "My Scorec…", two ellipses that differ
    // in one letter. So the bar takes `shortTitle` where the sidebar takes `title`:
    // the sidebar has the width for "My Scorecard" and the bar does not, and the fix
    // for that is a shorter word, not a smaller font.
    const BUDGET = 11;
    for (const role of ALL_ROLES) {
      const bar = navItems.filter((i) => (i.roles as string[]).includes(role)).slice(0, 3);
      for (const item of bar) {
        const label = item.shortTitle ?? item.title;
        expect(
          label.length,
          `a ${role} sees "${label}" truncated in the bottom bar — give it a shortTitle`,
        ).toBeLessThanOrEqual(BUDGET);
      }
    }
  });
});
