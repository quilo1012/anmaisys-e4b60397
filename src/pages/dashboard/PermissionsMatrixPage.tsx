import { useEffect, useMemo, useState } from "react";
import { Check, X, ShieldCheck, Info, Save, RotateCcw, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import { supabase } from "@/integrations/supabase/client";
import {
  can,
  defaultCan,
  isPermissionOverridden,
  setPermissionOverrides,
  ALL_ACTIONS,
  ALL_ROLES,
  type Action,
  type Role,
} from "@/lib/permissions";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  supervisor: "Supervisor",
  maintenance_manager: "Maint. Manager",
  planner: "Planner",
  engineer: "Engineer",
  co_engineer: "Co-Engineer",
  operator: "Operator",
  viewer: "Viewer",
};

const ACTION_GROUPS: { label: string; actions: Action[] }[] = [
  { label: "Work Orders", actions: ["wo.view", "wo.create", "wo.update", "wo.close", "wo.delete", "wo.force", "wo.print"] },
  { label: "Downtime", actions: ["downtime.view", "downtime.manage"] },
  { label: "Machines & Problems", actions: ["machines.view", "machines.manage", "problems.view", "problems.manage"] },
  { label: "Stock", actions: ["stock.view", "stock.manage", "stock.pricing"] },
  { label: "Users & Audit", actions: ["users.view", "users.manage", "audit.view"] },
  { label: "Reports", actions: ["reports.analytics", "reports.financial", "reports.executive"] },
  { label: "System", actions: ["system.clear", "system.settings"] },
];

const keyOf = (r: Role, a: Action) => `${r}:${a}`;

export default function PermissionsMatrixPage() {
  const { role } = useRole();
  const isAdmin = role === "admin";

  // Draft = current effective value per cell (true/false), mutated by admin clicks.
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Hydrate draft from current effective state (defaults + overrides).
  useEffect(() => {
    const init: Record<string, boolean> = {};
    for (const r of ALL_ROLES) for (const a of ALL_ACTIONS) init[keyOf(r, a)] = can(r, a);
    setDraft(init);
    setDirty(new Set());
    setLoading(false);
  }, []);

  const toggle = (r: Role, a: Action) => {
    if (!isAdmin) return;
    const k = keyOf(r, a);
    setDraft((prev) => ({ ...prev, [k]: !prev[k] }));
    setDirty((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const resetCell = (r: Role, a: Action) => {
    if (!isAdmin) return;
    const k = keyOf(r, a);
    setDraft((prev) => ({ ...prev, [k]: defaultCan(r, a) }));
    setDirty((prev) => {
      const next = new Set(prev);
      // Mark as change if current DB has an override or the reset value differs from override
      if (isPermissionOverridden(r, a) || can(r, a) !== defaultCan(r, a)) next.add(k);
      else next.delete(k);
      return next;
    });
  };

  const overriddenCount = useMemo(
    () =>
      ALL_ROLES.reduce((sum, r) => sum + ALL_ACTIONS.filter((a) => isPermissionOverridden(r, a)).length, 0),
    [draft]
  );

  const save = async () => {
    if (!isAdmin || dirty.size === 0) return;
    setSaving(true);
    try {
      const toUpsert: { role: Role; action: Action; allowed: boolean }[] = [];
      const toDelete: { role: Role; action: Action }[] = [];
      for (const k of dirty) {
        const [r, a] = k.split(":") as [Role, Action];
        const val = draft[k];
        if (val === defaultCan(r, a)) toDelete.push({ role: r, action: a });
        else toUpsert.push({ role: r, action: a, allowed: val });
      }

      if (toUpsert.length) {
        const { error } = await (supabase as any)
          .from("role_permission_overrides")
          .upsert(toUpsert, { onConflict: "role,action" });
        if (error) throw error;
      }
      for (const d of toDelete) {
        const { error } = await (supabase as any)
          .from("role_permission_overrides")
          .delete()
          .eq("role", d.role)
          .eq("action", d.action);
        if (error) throw error;
      }

      // Refetch and apply overrides globally.
      const { data } = await (supabase as any)
        .from("role_permission_overrides")
        .select("role, action, allowed");
      const map: Record<string, boolean> = {};
      for (const r of (data ?? []) as Array<{ role: string; action: string; allowed: boolean }>) {
        map[`${r.role}:${r.action}`] = r.allowed;
      }
      setPermissionOverrides(map);
      setDirty(new Set());
      toast({ title: "Permissions saved", description: `${toUpsert.length + toDelete.length} change(s) applied.` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    const init: Record<string, boolean> = {};
    for (const r of ALL_ROLES) for (const a of ALL_ACTIONS) init[keyOf(r, a)] = can(r, a);
    setDraft(init);
    setDirty(new Set());
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Permissions Matrix</h1>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? "Click any cell to toggle ✓/✗. Changes save to the database and apply live."
                : "Read-only view. Only admins can edit."}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Badge variant="outline">{overriddenCount} override(s)</Badge>
            {dirty.size > 0 && <Badge variant="secondary">{dirty.size} unsaved</Badge>}
            <Button variant="outline" size="sm" onClick={discard} disabled={saving || dirty.size === 0}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Discard
            </Button>
            <Button size="sm" onClick={save} disabled={saving || dirty.size === 0}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Save
            </Button>
          </div>
        )}
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>How overrides work</AlertTitle>
        <AlertDescription>
          Each cell shows the effective permission. Toggling a cell writes an override to the
          database that supersedes the default matrix. Reset a cell to its default with the small
          ↺ button that appears when it differs.
        </AlertDescription>
      </Alert>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        ACTION_GROUPS.map((group) => (
          <Card key={group.label}>
            <CardHeader>
              <CardTitle className="text-lg">{group.label}</CardTitle>
              <CardDescription>{group.actions.length} action(s)</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium">Action</th>
                    {ALL_ROLES.map((r) => (
                      <th key={r} className="p-2 text-center font-medium">
                        <Badge variant="outline" className="whitespace-nowrap">{ROLE_LABELS[r]}</Badge>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.actions.map((a) => (
                    <tr key={a} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="sticky left-0 z-10 bg-card p-2">
                        <div className="font-medium">{a.split(".")[1]}</div>
                        <div className="text-xs text-muted-foreground">{a}</div>
                      </td>
                      {ALL_ROLES.map((r) => {
                        const k = keyOf(r, a);
                        const allowed = draft[k] ?? can(r, a);
                        const isDirty = dirty.has(k);
                        const differsFromDefault = allowed !== defaultCan(r, a);
                        return (
                          <td key={r} className="p-1 text-center align-middle">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggle(r, a)}
                                disabled={!isAdmin}
                                aria-label={`${allowed ? "allowed" : "denied"} — click to toggle`}
                                className={[
                                  "inline-flex h-8 w-8 items-center justify-center rounded-md border transition",
                                  allowed
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                                    : "border-muted bg-muted/30 text-muted-foreground/60 hover:bg-muted",
                                  isDirty ? "ring-2 ring-primary" : "",
                                  !isAdmin ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                                ].join(" ")}
                              >
                                {allowed ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                              </button>
                              {isAdmin && differsFromDefault && (
                                <button
                                  type="button"
                                  title="Reset to default"
                                  onClick={() => resetCell(r, a)}
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                  ↺
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
