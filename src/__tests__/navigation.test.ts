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
    //
    // Quality is the third, and it is the one that pays for the heading rather than
    // inheriting it. Its single row used to be the fifth under Production, which read
    // as "quality is part of the production report" — it is not: it is the exception
    // a run raises, `quality_supervisor` lands on it and opens nothing else in that
    // group, and its verdicts split across two actions the database enforces. Here
    // the heading is the whole point; folding it back into Production would undo it.
    const EXEMPT = ["System", "Administration", "Quality"];
    const counts = new Map<string, number>();
    for (const i of navItems) counts.set(i.group, (counts.get(i.group) ?? 0) + 1);
    for (const [group, n] of counts) {
      if (EXEMPT.includes(group)) continue;
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

  it("keeps Production in reading order, week to shift to people", () => {
    // The sidebar renders items in array order, so the order IS the file order —
    // an item appended to the end of navItems lands at the bottom of its group.
    // Headcount spent a release declared among the admin screens for exactly that
    // reason, and read as an afterthought under Production.
    const order = navItems.filter((i) => i.group === "Production").map((i) => i.title);
    expect(order).toEqual([
      "RAG Weekly",
      "Performance",
      "SKU Products",
      "Production Control",
      "Headcount",
    ]);
  });

  it("keeps Quality out of Production and under its own heading", () => {
    // Moving it back one group is a one-word edit and would look like a tidy-up.
    // It is not: Quality is the exception a run raises, not a line of its report,
    // and `quality_supervisor` lands there and opens nothing else in that group.
    const quality = navItems.filter((i) => i.url === "/dashboard/quality");
    expect(quality).toHaveLength(1);
    expect(quality[0].group).toBe("Quality");
    expect(navItems.filter((i) => i.group === "Production").map((i) => i.title)).not.toContain("Quality");
  });

  it("keeps the two screens hidden from the menu out of it", () => {
    // Control Center and Reports were taken off the sidebar because nobody is
    // opening them — the wall map has no wall up, and nobody is asking the period
    // question. Both routes still open and both pages still work, so re-adding a row
    // is one line and would pass unnoticed. It is a product decision, not a cleanup:
    // this fails until somebody comes back to say the screen is in use again.
    for (const url of ["/dashboard/control-center", "/dashboard/reports"]) {
      expect(
        navItems.find((i) => i.url === url),
        `${url} is back in the sidebar — it was hidden because it is not being used`,
      ).toBeUndefined();
    }
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
    const rendered = ["Overview", "Maintenance", "Production", "Quality", "Planning", "Reports", "Communication", "Administration", "System"];
    for (const item of navItems) {
      expect(rendered, `"${item.title}" is in group "${item.group}", which is never rendered`).toContain(item.group);
    }
  });

  it("keeps the leader scorecard out of the operator's navigation", () => {
    // The operator's screen offers no door to the leader scorecard — it was removed
    // from here and from the line hub's tiles on the same pass. The route itself is
    // still live and still gated by the PIN (leader_self_scorecard checks it in the
    // database); what went away is the link. Re-adding a row here is a product
    // decision, not a cleanup.
    const item = navItems.find((i) => i.url === "/dashboard/leader/scorecard");
    expect(item, "the leader scorecard is back in the operator sidebar").toBeUndefined();
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
