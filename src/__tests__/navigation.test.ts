import { describe, it, expect } from "vitest";
import { navItems, SIDEBAR_GROUPS } from "@/components/DashboardLayout";
import { SYSTEM_TOOLS } from "@/pages/dashboard/SystemHubPage";
import { can, roleHolds, ALL_ACTIONS, ALL_ROLES, type Action, type Role } from "@/lib/permissions";

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
    // no longer renders would simply vanish from the menu. This used to keep its own
    // copy of the group list, which is a copy somebody forgets: it now reads the one
    // the sidebar itself renders from.
    for (const item of navItems) {
      expect(
        SIDEBAR_GROUPS as readonly string[],
        `"${item.title}" is in group "${item.group}", which is never rendered`,
      ).toContain(item.group);
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

/**
 * The other direction: a permission granted with no way in.
 *
 * The test above ("gates every item that names an action on that action") closes one
 * half of the gap — nobody is shown a link the matrix will refuse. Nothing closed the
 * other half, and that is the half that hurts: the matrix grants a screen, no sidebar
 * row offers it, and the person holding the right never learns they hold it. An empty
 * menu raises no error, so this failed silently for as long as it has existed.
 *
 * What it caught when it was written (08/09/2026): the two `quality_supervisor`
 * accounts hold `scorecard.fill` and `scorecard.approve` and had exactly one row in
 * their whole sidebar — Quality. The board they are meant to fill in was reachable
 * only by typing its URL, and the leader's card behind it refused them outright.
 *
 * Measured against the real user table rather than the enum, because the enum is not
 * the factory. Of the twelve roles, six have nobody in them at all — a rule written
 * for `supervisor` or `production_office_admin` protects no one and proves nothing,
 * and one comment in App.tsx already justifies a guard by "the supervisors who use it
 * today", of whom there are none.
 */
const ROLES_WITH_PEOPLE: Role[] = [
  "operator",           // 13
  "admin",              // 10
  "engineer",           //  2
  "quality_supervisor", //  2
  "maintenance_manager",//  1
  "warehouse",          //  1
];

/**
 * Granted, with no row, on purpose. Every entry needs a reason that says which of the
 * four kinds it is, because "no row" means four different things and only the last is
 * a defect:
 *
 *   - NO SCREEN: the matrix grants an action this app has no route for.
 *   - IN THE HUB: the screen lives behind the System hub, by the argument written
 *     into the navItems list — setup is not daily work.
 *   - OFF THE MENU: the route exists and was deliberately left out, with the reason
 *     recorded beside the item it was removed from.
 *   - REACHED FROM ANOTHER SCREEN: there is a way in, it is just not a menu row.
 *   - OPEN GAP: a real hole, named rather than papered over.
 *
 * An entry here is a decision on the record. A missing entry is a test failure.
 */
const NO_MENU_ROW: Partial<Record<Action, string>> = {
  "production.view": "NO SCREEN — a capability behind production sessions, not a page.",
  "planner.view": "NO SCREEN — the planner is a separate application.",
  "smarttarget.view": "NO SCREEN — no route in this app.",
  "engineers.view": "NO SCREEN — no route of its own; engineers are managed from the hub.",
  "leaders.view": "NO SCREEN — no route of its own; leaders are managed from the hub.",
  "notifications.view": "REACHED FROM ANOTHER SCREEN — the bell in the header, not a row.",
  "users.view": "IN THE HUB — Roles & Permissions, SystemHubPage.",
  "audit.view": "IN THE HUB — Audit Logs, SystemHubPage.",
  "intouch.view": "IN THE HUB — the three iTouching screens, SystemHubPage.",
  "workforce.view": "OFF THE MENU — seventeen people have no shift pattern, so the board would read as a rota when it is still an import. Reason recorded on the Headcount item.",
  "controlcenter.view": "OFF THE MENU — not being opened; route untouched.",
  "suppliers.view": "OFF THE MENU — part of Reports, taken off on the same pass.",
  "reliability.view": "OFF THE MENU — /dashboard/reliability; the Downtime & Reliability row goes to /dashboard/downtime.",
  "production.target.view": "REACHED FROM ANOTHER SCREEN — My Production is the operator's own screen; every other role reads targets on Performance and Production Control.",
  "sku.view": "REACHED FROM ANOTHER SCREEN — the SKU Products row gates on sku.manage, which is the narrower right.",
  "production.performance.view": "REACHED FROM ANOTHER SCREEN for the operator — a button on My Production. Every other role holding it has the Performance row.",
  "wo.view": "OPEN GAP for the engineer — the engineer dashboard is the way to a WO today, and giving engineers the full Maintenance Orders row is a decision nobody has taken.",
  "downtime.view": "OPEN GAP for the engineer — holds it, reaches downtime through the WO it belongs to.",
  "machines.view": "OPEN GAP for the engineer — holds it, no row.",
  "problems.view": "OPEN GAP for the engineer — holds it, no row.",
  // Not a ".view" action, and checked anyway: it names a screen in everything but
  // the word, and this list is where the answer to "why is there no row?" lives.
  "scorecard.fill": "REACHED FROM ANOTHER SCREEN — a leader's card is opened from Performance, on the leader the page is already filtered to. Every role holding scorecard.fill holds production.performance.view and has that row.",
};

describe("sidebar reachability", () => {
  // Every action that names a screen somebody navigates TO. ".view" is that set
  // by convention, plus scorecard.fill, which is a screen in everything but its
  // name — see the note on it in NO_MENU_ROW.
  // roleHolds, not can: this asks what a ROLE is allowed, and can() answers yes to
  // everything for an owner session, which would make the sweep pass by accident.
  const NAVIGABLE_ACTIONS: Action[] = [
    ...ALL_ACTIONS.filter((a) => a.endsWith(".view")),
    "scorecard.fill",
  ];

  it("gives every granted view action a row, or a reason there is none", () => {
    for (const role of ROLES_WITH_PEOPLE) {
      for (const action of NAVIGABLE_ACTIONS) {
        if (!roleHolds(role, action)) continue;
        const hasRow = navItems.some(
          (i) => i.action === action && (i.roles as string[]).includes(role),
        );
        if (hasRow) continue;
        expect(
          NO_MENU_ROW[action],
          `a ${role} holds "${action}" and has no sidebar row for it — add the row, or add the action to NO_MENU_ROW with the reason`,
        ).toBeDefined();
      }
    }
  });

  it("leaves the leader scorecard reachable by the roles that fill it", () => {
    // The scorecard has no row of its own, deliberately — a row would open it on
    // nobody in particular. That makes the Performance row the whole way in, so
    // "who can fill a scorecard" and "who has the Performance row" have to be the
    // same question. They were not: quality_supervisor held scorecard.approve and
    // had one row in the entire sidebar.
    const performance = navItems.find((i) => i.url === "/dashboard/production-performance");
    expect(performance, "the Performance row is gone — the scorecard has no way in").toBeDefined();
    for (const role of ROLES_WITH_PEOPLE) {
      if (!roleHolds(role, "scorecard.fill")) continue;
      expect(
        (performance!.roles as string[]).includes(role),
        `a ${role} fills in a leader scorecard but cannot open the screen it is reached from`,
      ).toBe(true);
    }
  });

  it("keeps no stale excuse in NO_MENU_ROW", () => {
    // An excuse that no longer excuses anything is worse than none: it reads as a
    // decision when it is a leftover, and the next reader trusts it.
    for (const [action, reason] of Object.entries(NO_MENU_ROW)) {
      const stillNeeded = ROLES_WITH_PEOPLE.some(
        (role) =>
          roleHolds(role, action as Action) &&
          !navItems.some((i) => i.action === action && (i.roles as string[]).includes(role)),
      );
      expect(
        stillNeeded,
        `"${action}" is excused ("${reason}") but every role that holds it now has a row — delete the entry`,
      ).toBe(true);
    }
  });

});

/**
 * A matriz semanal das esperas do armazém vive em `/dashboard/warehouse`.
 *
 * Até aqui esse ecrã só estava no menu para o papel `warehouse`, embora
 * `dashboard.warehouse` sempre tenha deixado o admin entrar: quem quisesse ler a
 * matriz tinha de saber o URL de cor. Uma página a que só se chega escrevendo o
 * endereço é uma página que ninguém abre.
 *
 * O terceiro teste é o que apanha o erro caro: uma linha de menu para um papel
 * que a rota depois recusa — visível, clicável, e a mandar a pessoa de volta.
 */
describe("o armazém no menu", () => {
  const rows = navItems.filter((i) => i.url === "/dashboard/warehouse");

  it("está ao alcance de quem lê a matriz", () => {
    for (const role of ["admin", "warehouse"] as Role[]) {
      const visible = rows.filter((i) => i.roles.includes(role));
      expect(visible.length, `${role} não vê o armazém no menu`).toBeGreaterThan(0);
      for (const row of visible) {
        expect(row.action ? can(role, row.action as Action) : true).toBe(true);
      }
    }
  });

  it("não é um ecrã de manutenção, e o cabeçalho tem de o dizer", () => {
    // Debaixo de MAINTENANCE a linha afirmava o contrário do que a própria página
    // promete: uma espera do armazém nunca conta como avaria de linha. A estrutura
    // não pode contradizer o conteúdo.
    for (const row of rows) {
      if (row.group === "Overview") continue; // o atalho do papel `warehouse`
      expect(row.group, `"${row.title}" voltou para ${row.group}`).toBe("Warehouse");
    }
    expect(SIDEBAR_GROUPS).toContain("Warehouse");
  });

  it("desenha-se depois de Production, não no meio da manutenção", () => {
    const order = SIDEBAR_GROUPS as readonly string[];
    expect(order.indexOf("Warehouse")).toBeGreaterThan(order.indexOf("Production"));
    expect(order.indexOf("Warehouse")).toBeGreaterThan(order.indexOf("Maintenance"));
  });

  it("deixa a manutenção com mais do que uma linha para cada papel que a abre", () => {
    // Tirar de lá o armazém não pode transformar Maintenance num cabeçalho sobre
    // uma linha só — foi isso que dissolveu Assets, Reports e Communication.
    for (const role of ALL_ROLES) {
      const n = navItems.filter((i) => i.group === "Maintenance" && i.roles.includes(role)).length;
      if (n === 0) continue;
      expect(n, `${role} vê ${n} linha em Maintenance`).toBeGreaterThan(1);
    }
  });

  it("nunca põe duas entradas do armazém no mesmo grupo", () => {
    // O papel `warehouse` vê-o duas vezes de propósito: uma como "Dashboard" em
    // Overview, outra como "Service Requests" em Maintenance. Duas no MESMO
    // grupo é que seria a mesma linha escrita duas vezes.
    for (const role of ALL_ROLES) {
      const byGroup = new Map<string, number>();
      for (const i of rows.filter((r) => r.roles.includes(role))) {
        byGroup.set(i.group, (byGroup.get(i.group) ?? 0) + 1);
      }
      for (const [group, n] of byGroup) {
        expect(n, `${role} vê ${n} entradas do armazém em ${group}`).toBe(1);
      }
    }
  });

  it("não abre a porta a quem a permissão fecha", () => {
    for (const role of ALL_ROLES) {
      if (!rows.some((i) => i.roles.includes(role))) continue;
      expect(can(role, "dashboard.warehouse"), `${role} tem a entrada mas não a permissão`).toBe(true);
    }
  });
});
