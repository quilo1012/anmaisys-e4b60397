import { useEffect, useMemo, useState } from "react";
import { Check, X, ShieldCheck, Info, Save, RotateCcw, Loader2, Search, Filter, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  maintenance_manager: "Maint.",
  planner: "Planner",
  engineer: "Engineer",
  co_engineer: "Co-Eng.",
  operator: "Operator",
  viewer: "Viewer",
};

const ACTION_GROUPS: { key: string; label: string; actions: Action[] }[] = [
  { key: "wo", label: "Work Orders", actions: ["wo.view", "wo.create", "wo.update", "wo.close", "wo.delete", "wo.force", "wo.print"] },
  { key: "downtime", label: "Downtime", actions: ["downtime.view", "downtime.manage"] },
  { key: "machines", label: "Machines & Problems", actions: ["machines.view", "machines.manage", "problems.view", "problems.manage"] },
  { key: "stock", label: "Stock", actions: ["stock.view", "stock.manage", "stock.pricing"] },
  { key: "production", label: "Production", actions: ["production.view", "production.manage", "production.target.view", "production.target.manage", "production.performance.view"] },
  { key: "planner", label: "Planner & SKU", actions: ["planner.view", "planner.manage", "sku.view", "sku.manage"] },
  { key: "rag", label: "RAG Weekly", actions: ["rag.view", "rag.manage", "rag.comment"] },
  { key: "smart", label: "Smart Target", actions: ["smarttarget.view"] },
  { key: "quality", label: "Quality", actions: ["quality.view", "quality.manage"] },
  { key: "pm", label: "Preventive Maint.", actions: ["pm.view", "pm.manage"] },
  { key: "eng", label: "Engineers & Leaders", actions: ["engineers.view", "engineers.manage", "leaders.view", "leaders.manage"] },
  { key: "chat", label: "Chat & Messages", actions: ["chat.line", "chat.dm"] },
  { key: "notif", label: "Notifications", actions: ["notifications.view", "notifications.manage"] },
  { key: "intouch", label: "iTouching", actions: ["intouch.view", "intouch.manage"] },
  { key: "cc", label: "Control Center", actions: ["controlcenter.view", "assets.manage"] },
  { key: "dash", label: "Dashboards", actions: ["dashboard.executive", "dashboard.manager", "dashboard.engineer", "dashboard.operator"] },
  { key: "users", label: "Users & Audit", actions: ["users.view", "users.manage", "audit.view"] },
  { key: "reports", label: "Reports", actions: ["reports.analytics", "reports.financial", "reports.executive"] },
  { key: "system", label: "System", actions: ["system.clear", "system.settings", "permissions.manage"] },
];

const ACTION_LABELS: Partial<Record<Action, string>> = {
  "chat.line": "Line Chat",
  "chat.dm": "Contact Supervisor / Manager",
};

const ACTION_DESCRIPTIONS: Partial<Record<Action, string>> = {
  "wo.view": "See the Work Orders list and details.",
  "wo.create": "Open new Work Orders / maintenance requests.",
  "wo.update": "Edit fields, assign engineers, change status.",
  "wo.close": "Mark Work Orders as completed.",
  "wo.delete": "Permanently remove Work Orders.",
  "wo.force": "Force-close a WO bypassing normal flow (admin action).",
  "wo.print": "Print or export Work Orders to PDF.",
  "downtime.view": "See downtime events and history.",
  "downtime.manage": "Create, edit and close downtime events.",
  "machines.view": "Browse the machines registry.",
  "machines.manage": "Add, edit or archive machines.",
  "problems.view": "See the catalogue of standard problems.",
  "problems.manage": "Add, edit or archive problem descriptions.",
  "stock.view": "See parts inventory and balances.",
  "stock.manage": "Add, adjust or consume parts and suppliers.",
  "stock.pricing": "See and edit part unit prices and financial values.",
  "production.view": "See production sessions and current runs.",
  "production.manage": "Start, edit or close production sessions.",
  "production.target.view": "See production targets per line/shift.",
  "production.target.manage": "Create and edit production targets.",
  "production.performance.view": "Access the Production Performance dashboard.",
  "planner.view": "Open the Planner and see the plan.",
  "planner.manage": "Edit the plan and schedule SKUs.",
  "sku.view": "Browse SKU catalogue and line speeds.",
  "sku.manage": "Create, edit or import SKUs and speeds.",
  "rag.view": "Open the RAG Weekly board.",
  "rag.manage": "Edit RAG entries and status.",
  "rag.comment": "Add comments on RAG weekly entries.",
  "smarttarget.view": "Access the Smart Target analytics page.",
  "quality.view": "See quality actions and issues.",
  "quality.manage": "Create and close quality actions.",
  "pm.view": "See preventive maintenance schedules.",
  "pm.manage": "Create schedules and register executions.",
  "engineers.view": "See the engineers list.",
  "engineers.manage": "Add, edit or deactivate engineers.",
  "leaders.view": "See line leaders and their PINs.",
  "leaders.manage": "Add, edit or deactivate line leaders.",
  "chat.line": "Use the per-line chat button and screen.",
  "chat.dm": "Send direct messages to Supervisor / Manager.",
  "notifications.view": "See the notifications center.",
  "notifications.manage": "Configure and clear notifications.",
  "intouch.view": "Open the iTouching monitoring pages.",
  "intouch.manage": "Configure iTouching mappings and imports.",
  "controlcenter.view": "Access the live factory Control Center.",
  "assets.manage": "Manage mobile assets and machine locations.",
  "dashboard.executive": "Access the Executive dashboard.",
  "dashboard.manager": "Access the Manager dashboard.",
  "dashboard.engineer": "Access the Engineer dashboard.",
  "dashboard.operator": "Access the Operator dashboard.",
  "users.view": "See the Staff Members list.",
  "users.manage": "Create, edit or deactivate users and roles.",
  "audit.view": "See the audit log of security-sensitive events.",
  "reports.analytics": "Open the Analytics reports.",
  "reports.financial": "See financial reports (labour cost, stock value).",
  "reports.executive": "Access executive-level reports.",
  "system.clear": "Bulk-clear operational data (dangerous, admin only).",
  "system.settings": "Change system-wide settings.",
  "permissions.manage": "Edit this Permissions Matrix.",
};

const keyOf = (r: Role, a: Action) => `${r}:${a}`;

export default function PermissionsMatrixPage() {
  const { role } = useRole();
  const isAdmin = role === "admin";

  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [visibleRoles, setVisibleRoles] = useState<Set<Role>>(new Set(ALL_ROLES));

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
      if (isPermissionOverridden(r, a) || can(r, a) !== defaultCan(r, a)) next.add(k);
      else next.delete(k);
      return next;
    });
  };

  const overriddenCount = useMemo(
    () => ALL_ROLES.reduce((sum, r) => sum + ALL_ACTIONS.filter((a) => isPermissionOverridden(r, a)).length, 0),
    []
  );

  const pendingChanges = useMemo(() => {
    return Array.from(dirty).map((k) => {
      const [r, a] = k.split(":") as [Role, Action];
      const next = draft[k];
      const prev = can(r, a);
      const isReset = next === defaultCan(r, a);
      return { key: k, role: r, action: a, from: prev, to: next, isReset };
    });
  }, [dirty, draft]);

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
      const { data } = await (supabase as any)
        .from("role_permission_overrides")
        .select("role, action, allowed");
      const map: Record<string, boolean> = {};
      for (const r of (data ?? []) as Array<{ role: string; action: string; allowed: boolean }>) {
        map[`${r.role}:${r.action}`] = r.allowed;
      }
      setPermissionOverrides(map);
      setDirty(new Set());
      setPreviewOpen(false);
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

  const rolesToShow = ALL_ROLES.filter((r) => visibleRoles.has(r));

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ACTION_GROUPS
      .filter((g) => tab === "all" || g.key === tab)
      .map((g) => ({
        ...g,
        actions: g.actions.filter((a) => {
          if (q && !a.toLowerCase().includes(q) && !g.label.toLowerCase().includes(q)) return false;
          if (onlyChanged) {
            return rolesToShow.some((r) => dirty.has(keyOf(r, a)) || isPermissionOverridden(r, a));
          }
          return true;
        }),
      }))
      .filter((g) => g.actions.length > 0);
  }, [search, tab, onlyChanged, dirty, rolesToShow]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold leading-tight">Permissions Matrix</h1>
              <p className="text-xs text-muted-foreground">
                {isAdmin ? "Click any cell to toggle. Changes apply live after save." : "Read-only view."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">{overriddenCount} override(s)</Badge>
            {dirty.size > 0 && <Badge variant="secondary" className="text-xs">{dirty.size} unsaved</Badge>}
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={discard} disabled={saving || dirty.size === 0}>
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Discard
                </Button>
                <Button size="sm" onClick={() => setPreviewOpen(true)} disabled={saving || dirty.size === 0}>
                  <Eye className="mr-1.5 h-4 w-4" />
                  Review & Save
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Filters row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action or group…"
              className="h-9 pl-8"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Filter className="mr-1.5 h-4 w-4" /> Roles ({visibleRoles.size}/{ALL_ROLES.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-popover">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALL_ROLES.map((r) => (
                <DropdownMenuCheckboxItem
                  key={r}
                  checked={visibleRoles.has(r)}
                  onCheckedChange={(v) => {
                    setVisibleRoles((prev) => {
                      const next = new Set(prev);
                      v ? next.add(r) : next.delete(r);
                      if (next.size === 0) next.add(r);
                      return next;
                    });
                  }}
                >
                  {ROLE_LABELS[r]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant={onlyChanged ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => setOnlyChanged((v) => !v)}
          >
            Only changed
          </Button>
        </div>
      </div>

      <Alert className="py-2">
        <Info className="h-4 w-4" />
        <AlertTitle className="text-sm">Overrides</AlertTitle>
        <AlertDescription className="text-xs">
          Toggling a cell writes a database override. Use ↺ to reset to the code default.
        </AlertDescription>
      </Alert>

      {/* Group tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-muted/50 p-1">
          <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
          {ACTION_GROUPS.map((g) => (
            <TabsTrigger key={g.key} value={g.key} className="text-xs">
              {g.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              No actions match your filters.
            </div>
          ) : (
            filteredGroups.map((group) => (
              <Card key={group.key} className="overflow-hidden">
                <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
                  <div className="text-sm font-semibold">{group.label}</div>
                  <Badge variant="outline" className="text-[10px]">{group.actions.length}</Badge>
                </div>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-muted/20">
                        <tr>
                          <th className="sticky left-0 z-10 min-w-[220px] border-b bg-muted/20 p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Action
                          </th>
                          {rolesToShow.map((r) => (
                            <th key={r} className="border-b p-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {ROLE_LABELS[r]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.actions.map((a, idx) => (
                          <tr
                            key={a}
                            className={`border-b last:border-0 ${idx % 2 === 0 ? "bg-background" : "bg-muted/10"} hover:bg-muted/30`}
                          >
                            <td className="sticky left-0 z-10 min-w-[260px] bg-inherit p-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium">{ACTION_LABELS[a] ?? a.split(".").slice(1).join(".")}</span>
                                {ACTION_DESCRIPTIONS[a] && (
                                  <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/70 hover:text-foreground" />
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-xs text-xs">
                                        {ACTION_DESCRIPTIONS[a]}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                              {ACTION_DESCRIPTIONS[a] && (
                                <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground line-clamp-2">
                                  {ACTION_DESCRIPTIONS[a]}
                                </div>
                              )}
                              <div className="font-mono text-[10px] text-muted-foreground/70">{a}</div>
                            </td>
                            {rolesToShow.map((r) => {
                              const k = keyOf(r, a);
                              const allowed = draft[k] ?? can(r, a);
                              const isDirty = dirty.has(k);
                              const differsFromDefault = allowed !== defaultCan(r, a);
                              return (
                                <td key={r} className="p-1 text-center align-middle">
                                  <div className="relative inline-flex items-center justify-center">
                                    <button
                                      type="button"
                                      onClick={() => toggle(r, a)}
                                      disabled={!isAdmin}
                                      aria-label={`${allowed ? "allowed" : "denied"} — toggle`}
                                      className={[
                                        "inline-flex h-7 w-7 items-center justify-center rounded-md border transition",
                                        allowed
                                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                                          : "border-border bg-muted/40 text-muted-foreground/60 hover:bg-muted",
                                        isDirty ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
                                        !isAdmin ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                                      ].join(" ")}
                                    >
                                      {allowed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                                    </button>
                                    {isAdmin && differsFromDefault && (
                                      <button
                                        type="button"
                                        title="Reset to default"
                                        onClick={() => resetCell(r, a)}
                                        className="absolute -right-3 -top-1 rounded-full bg-background text-[10px] text-muted-foreground hover:text-foreground"
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
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
