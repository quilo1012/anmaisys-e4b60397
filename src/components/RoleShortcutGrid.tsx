import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { navItems, navItemShows, SIDEBAR_GROUPS } from "@/components/DashboardLayout";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useDeviceType } from "@/hooks/use-device-type";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/*
 * The order lives in `SIDEBAR_GROUPS` and is imported, not copied.
 *
 * There was a `GROUP_ORDER` here with the same intent — "sidebar order, so the landing
 * screen and the menu agree" — written out by hand. It had drifted: it omitted
 * "Warehouse", which `navItems` uses, so the whole Warehouse block fell through the
 * "groups I do not recognise" tail and was drawn after System, in a different order
 * from the sidebar the same person had just been looking at. It also still carried
 * "Reports" and "Communication", which no row uses at all.
 *
 * A second copy of an order is a second thing to remember to update, and nobody
 * remembers. The sidebar's own list is the one the sidebar obeys, so it is the one
 * this grid obeys too.
 */

/**
 * Every screen this role can open on this device, grouped exactly as the sidebar
 * groups them.
 *
 * Derived from `navItems` rather than a hand-written list, so a screen added to the
 * menu appears here too — the curated list it replaced was missing Messages,
 * Settings, RAG Weekly and Root Diagnostics, and nobody noticed because the two
 * lists had no reason to agree.
 */
export function RoleShortcutGrid() {
  const { role } = useAuth();
  const device = useDeviceType();
  const navigate = useNavigate();
  const effectiveRole = (role === "co_engineer" ? "engineer" : role) as AppRole | null;

  const groups = useMemo(() => {
    // `navItemShows` is what the sidebar asks, so it is what this asks. The filter
    // written out here before was the same question missing a branch: it checked the
    // row's own role list and the device, and skipped the one that reads the overrides.
    // A permission granted on the Permissions page therefore added the line to the
    // sidebar and left the shortcut card out — the two surfaces disagreeing about the
    // same screen, on the landing page where somebody looks first.
    const items = effectiveRole
      ? navItems.filter((i) => navItemShows(i, effectiveRole, device))
      : [];
    const map = new Map<string, typeof items>();
    for (const it of items) {
      map.set(it.group, [...(map.get(it.group) ?? []), it]);
    }
    // `SIDEBAR_GROUPS` is `as const`, so its element type is the union of the ten
    // literals; widening it here is what lets a group string from `navItems` be
    // looked up in it at all.
    const ordem = SIDEBAR_GROUPS as readonly string[];
    return [
      ...ordem.filter((g) => map.has(g)),
      ...Array.from(map.keys()).filter((g) => !ordem.includes(g)),
    ].map((g) => ({ group: g, items: map.get(g)! }));
  }, [effectiveRole, device]);

  if (!groups.length) return null;

  return (
    <div className="space-y-6">
      {groups.map(({ group, items }) => (
        <section key={group} aria-label={group} className="space-y-3">
          <SectionHeading>{group}</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <Card
                  key={`${it.url}-${it.title}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(it.url)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(it.url); } }}
                  className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                >
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="min-w-0 flex-1 text-sm font-medium leading-tight">{it.title}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default RoleShortcutGrid;
