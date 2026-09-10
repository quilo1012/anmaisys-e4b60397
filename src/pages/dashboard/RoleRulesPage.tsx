/**
 * Role rules — read-only.
 *
 * EVERYTHING ON THIS PAGE IS DERIVED FROM THE LIVE MATRIX, NEVER TYPED TWICE. The
 * "can" and "cannot" lists are computed through `can(role, action)` over
 * `ALL_ACTIONS` / `ACTION_GROUPS` at render time, so the page reflects the matrix as
 * it is right now, including any override loaded from `role_permission_overrides`.
 * A hand-written list of rules would be right the day it is written and a lie the
 * first time somebody edits the matrix — and this page's whole value is that it can
 * be trusted. The only hand-written text is `ROLE_SUMMARY` in `permissions.ts`.
 *
 * No editing lives here. Changing something is done on /dashboard/permissions.
 */
import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { routeTitles } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackButton } from "@/components/BackButton";
import { Check, Minus, Printer, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import {
  ACTIVE_ROLES,
  ROLE_SUMMARY,
  roleDashMap,
  roleTitle,
  subscribeDeviceHidden,
  subscribePermissionOverrides,
  type Role,
} from "@/lib/permissions";
import { countAllowed, deriveRoleRules, type RuleEntry } from "@/lib/roleRules";

function deviceNote(e: RuleEntry): string | null {
  if (e.hiddenOnTablet && e.hiddenOnMobile) return "desktop only";
  if (e.hiddenOnMobile) return "not on phone";
  if (e.hiddenOnTablet) return "not on tablet";
  return null;
}

function ActionLine({ entry, allowed }: { entry: RuleEntry; allowed: boolean }) {
  const note = deviceNote(entry);
  return (
    <li className="flex items-start gap-2 py-0.5 text-sm">
      {allowed ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      )}
      <span className={allowed ? "text-foreground" : "text-muted-foreground"}>
        {entry.description}
        {entry.customised && (
          <Badge variant="outline" className="ml-2 h-4 px-1 text-[10px] font-semibold uppercase">
            Custom
          </Badge>
        )}
        {allowed && note && (
          <span className="ml-2 text-xs text-muted-foreground">({note})</span>
        )}
      </span>
    </li>
  );
}

export default function RoleRulesPage() {
  const [selected, setSelected] = useState<Role>("operator");
  const [search, setSearch] = useState("");
  // The matrix can change under the page (overrides arrive after login); re-derive.
  const [, setVersion] = useState(0);
  useEffect(() => {
    const a = subscribePermissionOverrides(() => setVersion((v) => v + 1));
    const b = subscribeDeviceHidden(() => setVersion((v) => v + 1));
    return () => { a(); b(); };
  }, []);

  const rules = useMemo(() => deriveRoleRules(selected), [selected]);
  const counts = useMemo(
    () => Object.fromEntries(ACTIVE_ROLES.map((r) => [r, countAllowed(r)])) as Record<Role, number>,
    [],
  );

  const q = search.trim().toLowerCase();
  const match = (e: RuleEntry) => !q || e.description.toLowerCase().includes(q) || e.action.includes(q);

  const landing = roleDashMap[selected];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 sm:p-6 print:p-0">
        <div className="print:hidden">
          <BackButton />
        </div>

        <PageHeader
          module="System · Access"
          title="Role rules"
          description="What each profile can and cannot do. Generated from the live permission matrix — it changes when the matrix changes."
          icon={<ShieldCheck className="h-5 w-5" />}
          actions={
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" /> Print
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard/permissions">
                  <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Edit permissions
                </Link>
              </Button>
            </div>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          {/* Role picker: a list on desktop, a Select on small screens. */}
          <div className="print:hidden">
            <div className="lg:hidden">
              <Select value={selected} onValueChange={(v) => setSelected(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleTitle[r]} · {counts[r]} actions
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <nav className="hidden flex-col gap-1 lg:flex" aria-label="Roles">
              {ACTIVE_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelected(r)}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    r === selected ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted/60"
                  }`}
                >
                  <span className="truncate">{roleTitle[r]}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{counts[r]}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="space-y-4 print:break-inside-avoid">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-xl font-bold">{roleTitle[selected]}</h3>
                  <Badge variant="secondary">{rules.allowed.length} actions</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{ROLE_SUMMARY[selected]}</p>
                <p className="text-sm">
                  <span className="font-medium">Lands on:</span>{" "}
                  {routeTitles[landing] ?? landing}
                </p>
                {rules.customisedCount > 0 && (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
                    {rules.customisedCount} permission{rules.customisedCount === 1 ? " on this role has" : "s on this role have"} been changed from the default.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="relative print:hidden">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search what this role can do…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Card className="print:break-inside-avoid">
              <CardContent className="p-4">
                <h4 className="mb-3 font-semibold text-success">Can do</h4>
                <div className="space-y-4">
                  {rules.groups
                    .map((g) => ({ g, items: g.allowed.filter(match) }))
                    .filter(({ items }) => items.length > 0)
                    .map(({ g, items }) => (
                      <div key={g.key}>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                        <ul className="mt-1">
                          {items.map((e) => <ActionLine key={e.action} entry={e} allowed />)}
                        </ul>
                      </div>
                    ))}
                  {rules.allowed.length === 0 && (
                    <p className="text-sm text-muted-foreground">This role holds no permissions.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="print:break-inside-avoid">
              <CardContent className="p-4">
                <h4 className="mb-3 font-semibold text-muted-foreground">Cannot do</h4>
                <div className="space-y-3">
                  {rules.groups.map((g) => {
                    // A group the role holds nothing in is one line, not twenty denials:
                    // the boundary only matters where there is some access.
                    if (g.noAccessAtAll) {
                      if (q) return null;
                      return (
                        <div key={g.key} className="text-sm text-muted-foreground">
                          {g.label} — no access at all
                        </div>
                      );
                    }
                    const items = g.denied.filter(match);
                    if (items.length === 0) return null;
                    return (
                      <div key={g.key}>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">{g.label}</div>
                        <ul className="mt-1">
                          {items.map((e) => <ActionLine key={e.action} entry={e} allowed={false} />)}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
