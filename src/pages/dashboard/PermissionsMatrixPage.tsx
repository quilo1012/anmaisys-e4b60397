import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Check, X, ShieldCheck, Info, Save, RotateCcw, Loader2, Search, Filter, Eye, ArrowLeft, Smartphone, Monitor, Tablet } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  isDeviceHidden,
  setDeviceHidden,
  type DeviceType,
  ALL_ACTIONS,
  ALL_ROLES,
  ACTION_GROUPS,
  ACTION_LABELS,
  ACTION_DESCRIPTIONS,
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
  warehouse: "Warehouse Admin",
};


const keyOf = (r: Role, a: Action) => `${r}:${a}`;

export default function PermissionsMatrixPage() {
  const { role } = useRole();
  const navigate = useNavigate();
  const isAdmin = role === "admin";

  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"access" | "tablet" | "mobile">("access");
  const [deviceDraft, setDeviceDraft] = useState<Record<string, boolean>>({}); // key `device:role:action` → visible
  const [deviceDirty, setDeviceDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [visibleRoles, setVisibleRoles] = useState<Set<Role>>(new Set(ALL_ROLES));

  const DEVICES: DeviceType[] = ["tablet", "mobile"];
  const dkey = (device: string, r: Role, a: Action) => `${device}:${r}:${a}`;

  useEffect(() => {
    const init: Record<string, boolean> = {};
    const initDev: Record<string, boolean> = {};
    for (const r of ALL_ROLES) for (const a of ALL_ACTIONS) {
      init[keyOf(r, a)] = can(r, a);
      for (const d of DEVICES) initDev[dkey(d, r, a)] = !isDeviceHidden(r, a, d); // true = visible on that device
    }
    setDraft(init);
    setDeviceDraft(initDev);
    setDirty(new Set());
    setDeviceDirty(new Set());
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDevice = (r: Role, a: Action) => {
    if (!isAdmin || mode === "access") return;
    const k = dkey(mode, r, a);
    setDeviceDraft((prev) => ({ ...prev, [k]: !(prev[k] ?? !isDeviceHidden(r, a, mode)) }));
    setDeviceDirty((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const saveDevice = async () => {
    if (!isAdmin || deviceDirty.size === 0) return;
    setSaving(true);
    try {
      const toHide: { role: string; action: string; device: string }[] = [];
      const toShow: { role: string; action: string; device: string }[] = [];
      for (const k of deviceDirty) {
        const [device, r, a] = k.split(":");
        (deviceDraft[k] ? toShow : toHide).push({ role: r, action: a, device });
      }
      if (toHide.length) {
        const { error } = await (supabase as any).from("role_mobile_hidden").upsert(toHide, { onConflict: "role,action,device" });
        if (error) throw error;
      }
      for (const row of toShow) {
        const { error } = await (supabase as any).from("role_mobile_hidden").delete().eq("role", row.role).eq("action", row.action).eq("device", row.device);
        if (error) throw error;
      }
      const hidden: string[] = [];
      for (const r of ALL_ROLES) for (const a of ALL_ACTIONS) for (const d of DEVICES) {
        if (!(deviceDraft[dkey(d, r, a)] ?? !isDeviceHidden(r, a, d))) hidden.push(`${r}:${a}:${d}`);
      }
      setDeviceHidden(hidden);
      setDeviceDirty(new Set());
      toast({ title: "Device visibility saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message ?? "Could not save.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

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

      // Audit log: one entry per changed cell with From → To
      try {
        const { logAuditEvent } = await import("@/hooks/useAuditLogs");
        await Promise.all(
          pendingChanges.map((c) =>
            logAuditEvent(
              "permission.change",
              "role_permission",
              `${c.role}:${c.action}`,
              {
                role: c.role,
                action: c.action,
                from: c.from ? "allowed" : "denied",
                to: c.to ? "allowed" : "denied",
                reset_to_default: c.isReset,
              }
            )
          )
        );
      } catch (auditErr) {
        console.warn("permission audit log failed", auditErr);
      }

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
    <DashboardLayout>
    <div className="space-y-4 p-4 md:p-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/settings")} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold leading-tight">Permissions Matrix</h1>
              <p className="text-xs text-muted-foreground">
                {!isAdmin ? "Read-only view."
                  : mode === "access" ? "Click any cell to toggle access. Changes apply live after save."
                  : `Toggle which screens each role sees on ${mode}. ${mode === "mobile" ? "📱" : "🖥"} = shown, ✕ = hidden on ${mode}. Only cells with access can be toggled. Desktop always shows everything the role can access.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Mode switch: Access · Tablet · Mobile visibility */}
            <div className="inline-flex rounded-md border p-0.5">
              <Button type="button" size="sm" variant={mode === "access" ? "default" : "ghost"} className="h-7 px-2.5" onClick={() => setMode("access")}>
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Access
              </Button>
              <Button type="button" size="sm" variant={mode === "tablet" ? "default" : "ghost"} className="h-7 px-2.5" onClick={() => setMode("tablet")}>
                <Tablet className="mr-1 h-3.5 w-3.5" /> Tablet
              </Button>
              <Button type="button" size="sm" variant={mode === "mobile" ? "default" : "ghost"} className="h-7 px-2.5" onClick={() => setMode("mobile")}>
                <Smartphone className="mr-1 h-3.5 w-3.5" /> Mobile
              </Button>
            </div>
            {mode === "access" ? (
              <>
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
              </>
            ) : (
              <>
                {deviceDirty.size > 0 && <Badge variant="secondary" className="text-xs">{deviceDirty.size} unsaved</Badge>}
                {isAdmin && (
                  <Button size="sm" onClick={saveDevice} disabled={saving || deviceDirty.size === 0}>
                    {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                    Save {mode}
                  </Button>
                )}
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
                              if (mode !== "access") {
                                const dk = dkey(mode, r, a);
                                const visible = deviceDraft[dk] ?? !isDeviceHidden(r, a, mode);
                                const devDirty = deviceDirty.has(dk);
                                const OnIcon = mode === "mobile" ? Smartphone : Tablet;
                                return (
                                  <td key={r} className="p-1 text-center align-middle">
                                    <button
                                      type="button"
                                      disabled={!isAdmin || !allowed}
                                      onClick={() => toggleDevice(r, a)}
                                      title={!allowed ? "No access" : visible ? `Visible on ${mode}` : `Hidden on ${mode}`}
                                      aria-label={visible ? `visible on ${mode}` : `hidden on ${mode}`}
                                      className={[
                                        "inline-flex h-7 w-7 items-center justify-center rounded-md border transition",
                                        !allowed
                                          ? "border-border bg-muted/20 text-muted-foreground/30 cursor-not-allowed"
                                          : visible
                                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 cursor-pointer"
                                          : "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 cursor-pointer",
                                        devDirty ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "",
                                      ].join(" ")}
                                    >
                                      {!allowed ? <X className="h-3.5 w-3.5" /> : visible ? <OnIcon className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                                    </button>
                                  </td>
                                );
                              }
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

      <Dialog open={previewOpen} onOpenChange={(o) => !saving && setPreviewOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Review permission changes
            </DialogTitle>
            <DialogDescription>
              {pendingChanges.length} change(s) will be applied. Review each row before saving —
              new value overwrites the current one for that role.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Role</th>
                  <th className="p-2 text-left">Action</th>
                  <th className="p-2 text-center">From</th>
                  <th className="p-2 text-center">To</th>
                </tr>
              </thead>
              <tbody>
                {pendingChanges.map((c) => (
                  <tr key={c.key} className="border-t">
                    <td className="p-2">
                      <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[c.role]}</Badge>
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{ACTION_LABELS[c.action] ?? c.action}</div>
                      {ACTION_DESCRIPTIONS[c.action] && (
                        <div className="text-[11px] text-muted-foreground">{ACTION_DESCRIPTIONS[c.action]}</div>
                      )}
                      {c.isReset && (
                        <Badge variant="secondary" className="mt-1 text-[10px]">Reset to default</Badge>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className={c.from ? "border-emerald-500/40 text-emerald-600" : "border-border text-muted-foreground"}>
                        {c.from ? "Allowed" : "Denied"}
                      </Badge>
                    </td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className={c.to ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-destructive/40 bg-destructive/5 text-destructive"}>
                        {c.to ? "Allowed" : "Denied"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || pendingChanges.length === 0}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Confirm & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}
