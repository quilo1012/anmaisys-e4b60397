import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { ToastAction } from "@/components/ui/toast";
// Tabs replaced by simple button group + conditional render for reliability
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { SignupSettingsCard } from "@/components/SignupSettingsCard";
import { UserPlus, Shield, Wrench as WrenchIcon, HardHat, Pencil, Trash2, Loader2, KeyRound, RefreshCw, Users as UsersIcon, Check, Package } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { checkPasswordSecurity, checkPasswordStrength, describePasswordError, generateStrongPassword } from "@/lib/passwordPolicy";
import type { Database } from "@/integrations/supabase/types";
import { can, isPermissionOverridden, ALL_ACTIONS, ALL_ROLES } from "@/lib/permissions";
import { Link } from "react-router-dom";



type AppRole = Database["public"]["Enums"]["app_role"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"] & { role?: AppRole };

interface Engineer {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  labor_rate?: number | null;
}

const roleLabels: Record<AppRole, string> = { admin: "Admin", manager: "Manager", supervisor: "Supervisor", quality_supervisor: "Supervisor QC", maintenance_manager: "Maintenance Manager", planner: "Planner", engineer: "Engineer", co_engineer: "Co-Engineer", operator: "Operator", viewer: "Viewer", warehouse: "Warehouse Admin" };
const roleIcons: Record<AppRole, React.ComponentType<{ className?: string }>> = {
  admin: Shield,
  manager: Shield,
  supervisor: Shield,
  quality_supervisor: Shield,
  maintenance_manager: WrenchIcon,
  planner: WrenchIcon,
  engineer: WrenchIcon,
  co_engineer: WrenchIcon,
  operator: HardHat,
  viewer: Shield,
  warehouse: Package,
};

const adminRoleOptions: AppRole[] = ["admin", "manager", "supervisor", "quality_supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer", "warehouse"];
const managerCreateRoleOptions: AppRole[] = ["engineer", "co_engineer"];
const managerEditRoleOptions: AppRole[] = ["engineer", "co_engineer", "operator"];
const protectedStaffRoles: AppRole[] = ["admin", "manager", "supervisor", "quality_supervisor", "maintenance_manager", "planner"];

function roleBadgeClass(role?: AppRole) {
  if (role === "admin") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (role === "manager") return "border-primary/30 bg-primary/10 text-primary";
  if (role === "supervisor") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (role === "maintenance_manager" || role === "planner") return "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  if (role === "engineer" || role === "co_engineer") return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function RolePermissionPreview({ selectedRole }: { selectedRole: AppRole }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Permissions for {roleLabels[selectedRole]}</p>
        <Badge variant="outline" className={roleBadgeClass(selectedRole)}>{roleLabels[selectedRole]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        This role inherits the standard permissions.{" "}
        <Link to="/dashboard/permissions" className="font-medium text-primary underline underline-offset-2">
          View full list
        </Link>
      </p>
    </div>
  );
}

function RolePermissionsSummary() {
  const total = ALL_ACTIONS.length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4" /> Role permissions
        </CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/permissions">Open Permissions Matrix</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {ALL_ROLES.map((roleOption) => {
          const allowedCount = ALL_ACTIONS.filter((a) => can(roleOption, a)).length;
          const overrideCount = ALL_ACTIONS.filter((a) => isPermissionOverridden(roleOption, a)).length;
          return (
            <div
              key={roleOption}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
            >
              <Badge variant="outline" className={roleBadgeClass(roleOption)}>
                {roleLabels[roleOption]}
              </Badge>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{allowedCount}</span> / {total} allowed
                </span>
                {overrideCount > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {overrideCount} override{overrideCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}


interface Leader {
  id: string;
  name: string;
  is_active: boolean;
  line: string | null;
  lines: string[] | null;
  created_at: string;
}


function InlineLaborRateCell({ engineer, onSaved }: { engineer: Engineer; onSaved: () => void }) {
  const [value, setValue] = useState(String(engineer.labor_rate ?? 0));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const commit = async () => {
    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed < 0) {
      setValue(String(engineer.labor_rate ?? 0));
      return;
    }
    if (parsed === Number(engineer.labor_rate ?? 0)) return;
    setSaving(true);
    try {
      const res = await invokeFunction<{ success: boolean }>("update-engineer", {
        engineerId: engineer.id,
        laborRate: parsed,
      });
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.success) throw new Error("Failed to save");
      qc.invalidateQueries({ queryKey: ["engineer_labor_rates"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setValue(String(engineer.labor_rate ?? 0));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground text-xs">£</span>
      <Input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setValue(String(engineer.labor_rate ?? 0));
        }}
        disabled={saving}
        className="h-8 w-24 text-right"
      />
      <span className="text-muted-foreground text-xs">/h</span>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {saved && <Check className="h-4 w-4 text-emerald-500" />}
    </div>
  );
}


export default function ManageUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [activeTab, setActiveTab] = useState<"staff" | "engineers" | "leaders">("staff");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("operator");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user: currentUser, role: currentRole } = useAuth();
  const createRoleOptions = currentRole === "admin" ? adminRoleOptions : managerCreateRoleOptions;
  const editRoleOptions = currentRole === "admin" ? adminRoleOptions : managerEditRoleOptions;

  // Edit user state
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<AppRole>("operator");
  const [editActive, setEditActive] = useState(true);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editPasswordError, setEditPasswordError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Delete state
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  // Engineers state
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [engOpen, setEngOpen] = useState(false);
  const [engName, setEngName] = useState("");
  const [engPin, setEngPin] = useState("");
  const [engLoading, setEngLoading] = useState(false);
  const [editEng, setEditEng] = useState<Engineer | null>(null);
  const [editEngName, setEditEngName] = useState("");
  const [editEngPin, setEditEngPin] = useState("");
  const [editEngActive, setEditEngActive] = useState(true);
  const [editEngLoading, setEditEngLoading] = useState(false);
  const [deleteEngLoading, setDeleteEngLoading] = useState<string | null>(null);

  // Leaders state
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [ldOpen, setLdOpen] = useState(false);
  const [ldName, setLdName] = useState("");
  const [ldPin, setLdPin] = useState("");
  const [ldLine, setLdLine] = useState("");
  const [ldLoading, setLdLoading] = useState(false);
  const [editLd, setEditLd] = useState<Leader | null>(null);
  const [editLdName, setEditLdName] = useState("");
  const [editLdPin, setEditLdPin] = useState("");
  const [editLdActive, setEditLdActive] = useState(true);
  const [editLdLine, setEditLdLine] = useState("");
  const [editLdLoading, setEditLdLoading] = useState(false);
  const [deleteLdLoading, setDeleteLdLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!createRoleOptions.includes(role)) {
      setRole(createRoleOptions[0] ?? "engineer");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  const fetchLeaders = async () => {
    if (!currentUser?.id || !currentRole) return;
    const { data, error } = await supabase.rpc("list_leaders" as any);
    if (error) {
      console.error("[ManageUsers] list_leaders failed", error);
      return;
    }
    setLeaders((data as Leader[]) ?? []);
  };

  // Normalize a single line label: trim, collapse inner whitespace,
  // Title-case the "line" word so "line 1" / "LINE  1" both become "Line 1".
  const normalizeLine = (raw: string): string => {
    const clean = raw.replace(/\s+/g, " ").trim();
    if (!clean) return "";
    return clean.replace(/^line\s+/i, "Line ");
  };

  // Accept comma OR semicolon separated input, normalize each value,
  // dedupe case-insensitively while preserving first-seen casing.
  const parseLines = (raw: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(/[,;]/)) {
      const norm = normalizeLine(part);
      if (!norm) continue;
      const key = norm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(norm);
    }
    return out;
  };

  const handleCreateLeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ldName.trim() || ldPin.length !== 4) return;
    const lines = parseLines(ldLine);
    if (lines.length === 0) {
      toast({ title: "Lines required", description: "Enter at least one line (comma-separated).", variant: "destructive" });
      return;
    }
    setLdLoading(true);
    try {
      const { error } = await supabase.rpc("create_leader" as any, { _name: ldName.trim(), _pin: ldPin, _lines: lines });
      if (error) throw error;
      toast({ title: "Leader created", description: `${ldName} · ${lines.join(", ")}` });
      setLdOpen(false);
      setLdName(""); setLdPin(""); setLdLine("");
      fetchLeaders();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLdLoading(false);
    }
  };

  const openEditLeader = (l: Leader) => {
    setEditLd(l);
    setEditLdName(l.name);
    setEditLdPin("");
    setEditLdActive(l.is_active);
    setEditLdLine((l.lines && l.lines.length > 0 ? l.lines : (l.line ? [l.line] : [])).join(", "));
  };

  const handleEditLeader = async () => {
    if (!editLd) return;
    const lines = parseLines(editLdLine);
    if (lines.length === 0) {
      toast({ title: "Lines required", description: "Enter at least one line (comma-separated).", variant: "destructive" });
      return;
    }
    setEditLdLoading(true);
    try {
      const { error } = await supabase.rpc("update_leader" as any, {
        _id: editLd.id,
        _name: editLdName.trim() || null,
        _active: editLdActive,
        _pin: editLdPin.length === 4 ? editLdPin : null,
        _lines: lines,
      });
      if (error) throw error;
      toast({ title: "Leader updated", description: lines.join(", ") });
      setEditLd(null);
      fetchLeaders();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEditLdLoading(false);
    }
  };


  const handleDeleteLeader = async (id: string) => {
    setDeleteLdLoading(id);
    try {
      const { error } = await supabase.rpc("delete_leader" as any, { _id: id });
      if (error) throw error;
      toast({ title: "Leader deleted" });
      fetchLeaders();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleteLdLoading(null);
    }
  };

  const fetchUsers = async () => {
    // Select explicit columns — labor_rate is admin-only and fetched via RPC below

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email, shift, active, last_seen_at, ui_preferences, created_at, updated_at");
    if (!profiles) return;
    const { data: roles } = await supabase.from("user_roles").select("*");
    const roleMap = new Map(roles?.map((r) => [r.user_id, r.role]));

    // Fetch labor_rate via admin-only SECURITY DEFINER RPC (admins only)
    let rateMap = new Map<string, number>();
    if (currentRole === "admin") {
      const { data: rates } = await supabase.rpc("list_profile_labor_rates");
      rateMap = new Map((rates ?? []).map((r: any) => [r.id, Number(r.labor_rate) || 0]));
    }

    // Managers should not see admin accounts in the list
    const filtered = currentRole === "manager"
      ? profiles.filter((p: any) => roleMap.get(p.id) !== "admin")
      : profiles;

    setUsers(
      filtered.map((p: any) => ({
        ...p,
        labor_rate: rateMap.get(p.id) ?? 0,
        role: roleMap.get(p.id),
      })) as Profile[]
    );
  };

  const fetchEngineers = async () => {
    if (!currentUser?.id || !currentRole) {
      return;
    }

    // Retry transient edge runtime errors (cold starts return 503 intermittently)

    let res = await invokeFunction<Engineer[]>("list-engineers");
    let attempts = 1;
    while (
      res.error &&
      attempts < 3 &&
      ((res.error as any)?.context?.code === "SUPABASE_EDGE_RUNTIME_ERROR" ||
        /temporarily unavailable|503/i.test((res.error as any)?.message ?? ""))
    ) {
      await new Promise((r) => setTimeout(r, 600 * attempts));
      res = await invokeFunction<Engineer[]>("list-engineers");
      attempts++;
    }

    if (res.error) {
      console.error("[ManageUsers] list-engineers failed:", res.error);
      toast({
        title: "Failed to load engineers",
        description: (res.error as any)?.message ?? "Try refreshing the page.",
        variant: "destructive",
        action: <ToastAction altText="Retry" onClick={fetchEngineers}>Retry</ToastAction>,
      });
      return;
    }
    setEngineers((res.data as Engineer[]) ?? []);
  };

  useEffect(() => {
    // Wait for both the session user AND the role to be resolved before
    // making any authenticated calls (avoids race where session is restoring
    // but role hasn't been fetched yet).
    if (!currentUser?.id || !currentRole) return;
    fetchUsers();
    fetchEngineers();
    fetchLeaders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentRole]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const strength = await checkPasswordSecurity(password);
    if (!strength.ok) {
      setPasswordError(strength.reason ?? "Use a stronger password.");
      toast({ title: "Invalid password", description: strength.reason, variant: "destructive" });
      return;
    }
    setPasswordError(null);
    setLoading(true);
    try {
      const res = await Promise.race([
        invokeFunction("create-user", { email: email.trim().toLowerCase(), password, name: name.trim(), role }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out after 15s. The server did not respond — check Edge Function logs for create-user.")), 15000)
        ),
      ]) as { error?: { message: string } | null; data?: { error?: string } | null };
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast({ title: "User created", description: `${name} has been added as ${roleLabels[role]}` });
      logAuditEvent("user_created", "user", undefined, { name: name.trim(), email: email.trim().toLowerCase(), role });
      setOpen(false);
      setEmail(""); setPassword(""); setPasswordError(null); setName(""); setRole(createRoleOptions[0] ?? "engineer");
      await Promise.all([fetchUsers(), fetchEngineers()]);
    } catch (error: any) {
      const message = describePasswordError(error.message);
      setPasswordError(message);
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openEditUser = (u: Profile) => {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role || "operator");
    // A pending user (no role yet) opens ready to approve: default the login to Active.
    setEditActive(u.role ? u.active : true);
    setEditEmail(u.email);
    setEditPassword("");
    setEditPasswordError(null);
  };

  const validatePassword = async (pwd: string): Promise<string | null> => {
    if (pwd.length > 128) return "Password must be at most 128 characters long.";
    const strength = await checkPasswordSecurity(pwd);
    return strength.ok ? null : strength.reason ?? "Use a stronger password.";
  };

  const handleEditUser = async () => {
    if (!editUser) return;

    const trimmedPassword = editPassword.trim();
    if (trimmedPassword) {
      const pwdError = await validatePassword(trimmedPassword);
      if (pwdError) {
        setEditPasswordError(pwdError);
        toast({ title: "Invalid password", description: pwdError, variant: "destructive" });
        return;
      }
    }
    setEditPasswordError(null);

    setEditLoading(true);
    try {
      const body: Record<string, unknown> = {
        userId: editUser.id,
        name: editName.trim(),
        role: editRole,
        active: editActive,
      };
      if (editEmail.trim() !== editUser.email) {
        body.email = editEmail.trim().toLowerCase();
      }
      if (trimmedPassword) {
        body.password = trimmedPassword;
      }
      const res = await invokeFunction("update-user", body);
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      if (editUser.role !== editRole) {
        logAuditEvent("user_role_changed", "user", editUser.id, { name: editName.trim(), email: editEmail.trim(), old_role: editUser.role, new_role: editRole });
      }
      toast({ title: "User updated" });
      setEditUser(null);
      await Promise.all([fetchUsers(), fetchEngineers()]);
    } catch (error: any) {
      const message = describePasswordError(error.message);
      setEditPasswordError(message);
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setEditLoading(false);
    }
  };

  const fillGeneratedUserPassword = async (target: "create" | "edit") => {
    const next = generateStrongPassword();
    if (target === "create") {
      setPassword(next);
      setPasswordError(null);
    } else {
      setEditPassword(next);
      setEditPasswordError(null);
    }
    try {
      await navigator.clipboard.writeText(next);
      toast({ title: "Strong password generated", description: "Copied to clipboard." });
    } catch {
      toast({ title: "Strong password generated", description: "Copy it before closing this dialog." });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeleteLoading(userId);
    const targetUser = users.find(u => u.id === userId);
    try {
      const res = await invokeFunction("delete-user", { userId });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      logAuditEvent("user_deleted", "user", userId, { name: targetUser?.name, email: targetUser?.email });
      toast({ title: "User deleted" });
      await Promise.all([fetchUsers(), fetchEngineers()]);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setDeleteLoading(null);
    }
  };

  // Engineer CRUD
  const handleCreateEngineer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!engName.trim() || engPin.length < 4) return;
    setEngLoading(true);
    try {
      const res = await invokeFunction<{ success: boolean; engineerId: string }>("create-engineer", {
        name: engName.trim(),
        pin: engPin,
      });
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.success) throw new Error("Failed to create engineer");
      toast({ title: "Engineer created", description: `${engName} has been added` });
      setEngOpen(false);
      setEngName(""); setEngPin("");
      fetchEngineers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setEngLoading(false);
    }
  };

  const openEditEngineer = (eng: Engineer) => {
    setEditEng(eng);
    setEditEngName(eng.name);
    setEditEngPin("");
    setEditEngActive(eng.is_active);
  };

  const handleEditEngineer = async () => {
    if (!editEng) return;
    setEditEngLoading(true);
    try {
      const res = await invokeFunction<{ success: boolean }>("update-engineer", {
        engineerId: editEng.id,
        name: editEngName.trim(),
        active: editEngActive,
        pin: editEngPin.length >= 4 ? editEngPin : undefined,
      });
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.success) throw new Error("Failed to update engineer");
      if (editEngPin.length >= 4) {
        logAuditEvent("pin_changed", "engineer", editEng.id, { engineer_name: editEngName.trim() });
        toast({ title: "PIN updated", description: `PIN updated for ${editEngName.trim()}` });
      } else {
        toast({ title: "Engineer updated" });
      }
      setEditEng(null);
      fetchEngineers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setEditEngLoading(false);
    }
  };

  const handleDeleteEngineer = async (engId: string) => {
    setDeleteEngLoading(engId);
    try {
      const res = await invokeFunction<{ success: boolean }>("delete-engineer", { engineerId: engId });
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.success) throw new Error("Failed to delete engineer");
      toast({ title: "Engineer deleted" });
      fetchEngineers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setDeleteEngLoading(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-1">
            Manage staff logins, tablet station logins, and engineer PIN identities — all in one place.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border pb-2">
          <Button
            type="button"
            variant={activeTab === "staff" ? "default" : "ghost"}
            onClick={() => setActiveTab("staff")}
            className="gap-2"
          >
            <UsersIcon className="h-4 w-4" /> Staff
          </Button>
          <Button
            type="button"
            variant={activeTab === "engineers" ? "default" : "ghost"}
            onClick={() => setActiveTab("engineers")}
            className="gap-2"
          >
            <KeyRound className="h-4 w-4" /> Engineers (PIN)
          </Button>
          <Button
            type="button"
            variant={activeTab === "leaders" ? "default" : "ghost"}
            onClick={() => setActiveTab("leaders")}
            className="gap-2"
          >
            <KeyRound className="h-4 w-4" /> Leaders (PIN)
          </Button>
        </div>

        <div className={activeTab === "staff" ? "space-y-4" : "hidden"}>
        {currentRole === "admin" && <SignupSettingsCard />}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Staff Members</h2>
            <p className="text-muted-foreground">Admins, managers and engineers — people who log in with their personal email</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><UserPlus className="h-4 w-4 mr-2" />New User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateUser} className="space-y-4" autoComplete="off">
                <div className="space-y-2"><Label>Full Name <span className="text-destructive">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
                <div className="space-y-2"><Label>Email <span className="text-destructive">*</span></Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div className="space-y-2">
                  <Label>Password <span className="text-destructive">*</span></Label>
                  <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => fillGeneratedUserPassword("create")}>
                    <KeyRound className="h-4 w-4 mr-2" />Generate strong password
                  </Button>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    minLength={8}
                    required
                    aria-invalid={!!passwordError}
                  />
                  {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Role <span className="text-destructive">*</span></Label>
                   <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {createRoleOptions.map((roleOption) => (
                        <SelectItem key={roleOption} value={roleOption}>{roleLabels[roleOption]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <RolePermissionPreview selectedRole={role} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating..." : "Create User"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {currentRole === "admin" && <RolePermissionsSummary />}

        <Card>
          <CardHeader><CardTitle>Staff Members</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const RoleIcon = user.role ? roleIcons[user.role] : Shield;
                  const isCurrentUser = user.id === currentUser?.id;
                  const managerBlockedTarget = currentRole !== "admin" && !!user.role && protectedStaffRoles.includes(user.role);
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <RoleIcon className="h-4 w-4" />
                          <Badge variant="outline" className={roleBadgeClass(user.role)}>
                            {user.role ? roleLabels[user.role] : "No role"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.active ? "default" : "secondary"}>
                          {user.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!user.role && !managerBlockedTarget && (
                            <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => openEditUser(user)}>
                              <Check className="h-4 w-4" /> Approve
                            </Button>
                          )}
                          {!managerBlockedTarget && (
                            <Button size="icon" variant="ghost" onClick={() => openEditUser(user)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {!isCurrentUser && !managerBlockedTarget && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete user?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete <strong>{user.name}</strong> ({user.email}). This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteUser(user.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    {deleteLoading === user.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
          </div>

        <div className={activeTab === "engineers" ? "space-y-4" : "hidden"}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Engineers (PIN Identity)</h2>
            <p className="text-muted-foreground">Manage engineer identities for PIN-based actions</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={fetchEngineers} aria-label="Refresh engineers">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Dialog open={engOpen} onOpenChange={setEngOpen}>
              <DialogTrigger asChild>
                <Button><KeyRound className="h-4 w-4 mr-2" />New Engineer</Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Engineer Identity</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateEngineer} className="space-y-4" autoComplete="off">
                <div className="space-y-2"><Label>Engineer Name <span className="text-destructive">*</span></Label><Input value={engName} onChange={(e) => setEngName(e.target.value)} required /></div>
                <div className="space-y-2">
                  <Label>PIN (4 digits) <span className="text-destructive">*</span></Label>
                  <Input type="password" value={engPin} onChange={(e) => setEngPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 1234" minLength={4} maxLength={4} required />
                </div>
                <Button type="submit" className="w-full" disabled={engLoading || engPin.length < 4}>
                  {engLoading ? "Creating..." : "Create Engineer"}
                </Button>
              </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>All Engineers</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {engineers.map((eng) => (
                  <TableRow key={eng.id}>
                    <TableCell className="font-medium">{eng.name}</TableCell>
                    <TableCell>
                      <Badge variant={eng.is_active ? "default" : "secondary"}>
                        {eng.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    
                    <TableCell className="text-muted-foreground">{new Date(eng.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEditEngineer(eng)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete engineer?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete <strong>{eng.name}</strong>. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteEngineer(eng.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deleteEngLoading === eng.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {engineers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No engineers configured. Add engineers to enable PIN-based actions.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
          </div>

        <div className={activeTab === "leaders" ? "space-y-4" : "hidden"}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Leaders (PIN Identity)</h2>
              <p className="text-muted-foreground">Line Leaders authorized to unlock target displays via PIN</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={fetchLeaders} aria-label="Refresh leaders">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Dialog open={ldOpen} onOpenChange={setLdOpen}>
                <DialogTrigger asChild>
                  <Button><KeyRound className="h-4 w-4 mr-2" />New Leader</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Leader Identity</DialogTitle></DialogHeader>
                  <form onSubmit={handleCreateLeader} className="space-y-4" autoComplete="off">
                    <div className="space-y-2"><Label>Leader Name <span className="text-destructive">*</span></Label><Input value={ldName} onChange={(e) => setLdName(e.target.value)} required /></div>
                    <div className="space-y-2">
                      <Label>Lines</Label>
                      <Input value={ldLine} onChange={(e) => setLdLine(e.target.value)} placeholder="e.g. Line 1, Line 2" />
                      <p className="text-xs text-muted-foreground">Comma-separated. Leader will unlock Target for any of these lines.</p>
                    </div>

                    <div className="space-y-2">
                      <Label>PIN (4 digits) <span className="text-destructive">*</span></Label>
                      <Input type="password" value={ldPin} onChange={(e) => setLdPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 1234" minLength={4} maxLength={4} required />
                    </div>
                    <Button type="submit" className="w-full" disabled={ldLoading || ldPin.length < 4}>
                      {ldLoading ? "Creating..." : "Create Leader"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <Card>
            <CardHeader><CardTitle>All Leaders</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaders.map((ld) => (
                    <TableRow key={ld.id}>
                      <TableCell className="font-medium">{ld.name}</TableCell>
                      <TableCell className="text-muted-foreground">{(ld.lines && ld.lines.length > 0 ? ld.lines.join(", ") : (ld.line || "—"))}</TableCell>

                      <TableCell>
                        <Badge variant={ld.is_active ? "default" : "secondary"}>
                          {ld.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{new Date(ld.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEditLeader(ld)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete leader?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete <strong>{ld.name}</strong>. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteLeader(ld.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  {deleteLdLoading === ld.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {leaders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No leaders configured.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Edit Leader Dialog */}
        <Dialog open={!!editLd} onOpenChange={(open) => !open && setEditLd(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Leader</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Leader Name</Label><Input value={editLdName} onChange={(e) => setEditLdName(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Lines</Label>
                <Input value={editLdLine} onChange={(e) => setEditLdLine(e.target.value)} placeholder="e.g. Line 1, Line 2" />
                <p className="text-xs text-muted-foreground">Comma-separated. Leader will unlock Target for any of these lines.</p>
              </div>

              <div className="space-y-2">
                <Label>New PIN (4 digits)</Label>
                <Input type="password" value={editLdPin} onChange={(e) => setEditLdPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Leave blank to keep current" minLength={4} maxLength={4} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={editLdActive} onCheckedChange={setEditLdActive} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditLd(null)}>Cancel</Button>
              <Button onClick={handleEditLeader} disabled={editLdLoading}>
                {editLdLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* Edit User Dialog */}
        <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Full Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>New Password</Label>
                <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => fillGeneratedUserPassword("edit")}>
                  <KeyRound className="h-4 w-4 mr-2" />Generate strong password
                </Button>
                <Input
                  type="password"
                  value={editPassword}
                  onChange={(e) => {
                    setEditPassword(e.target.value);
                    setEditPasswordError(null);
                  }}
                  placeholder="Leave blank to keep current"
                  minLength={8}
                  maxLength={128}
                  aria-invalid={!!editPasswordError}
                />
                {editPasswordError && <p className="text-xs text-destructive">{editPasswordError}</p>}
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {editRoleOptions.map((roleOption) => (
                      <SelectItem key={roleOption} value={roleOption}>{roleLabels[roleOption]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <RolePermissionPreview selectedRole={editRole} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={editActive} onCheckedChange={setEditActive} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button onClick={handleEditUser} disabled={editLoading}>
                {editLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Engineer Dialog */}
        <Dialog open={!!editEng} onOpenChange={(open) => !open && setEditEng(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Engineer</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Engineer Name</Label><Input value={editEngName} onChange={(e) => setEditEngName(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>New PIN (4 digits)</Label>
                <Input type="password" value={editEngPin} onChange={(e) => setEditEngPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Leave blank to keep current" minLength={4} maxLength={4} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={editEngActive} onCheckedChange={setEditEngActive} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditEng(null)}>Cancel</Button>
              <Button onClick={handleEditEngineer} disabled={editEngLoading}>
                {editEngLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
