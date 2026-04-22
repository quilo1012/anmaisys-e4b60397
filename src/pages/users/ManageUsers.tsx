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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { UserPlus, Shield, Wrench as WrenchIcon, HardHat, Pencil, Trash2, Loader2, KeyRound } from "lucide-react";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"] & { role?: AppRole };

interface Engineer {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

const roleLabels: Record<AppRole, string> = { admin: "Admin", manager: "Manager", engineer: "Engineer", operator: "Operator", viewer: "Viewer" };
const roleIcons: Record<AppRole, React.ComponentType<{ className?: string }>> = {
  admin: Shield,
  manager: Shield,
  engineer: WrenchIcon,
  operator: HardHat,
  viewer: Shield,
};

export default function ManageUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("operator");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user: currentUser, role: currentRole } = useAuth();

  // Edit user state
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<AppRole>("operator");
  const [editActive, setEditActive] = useState(true);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
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
    const res = await invokeFunction<Engineer[]>("list-engineers");
    if (res.error) return;
    if (res.data) setEngineers(res.data as any);
  };

  useEffect(() => { if (currentRole) fetchUsers(); fetchEngineers(); }, [currentRole]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await invokeFunction("create-user", { email: email.trim().toLowerCase(), password, name: name.trim(), role });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast({ title: "User created", description: `${name} has been added as ${roleLabels[role]}` });
      logAuditEvent("user_created", "user", undefined, { name: name.trim(), email: email.trim().toLowerCase(), role });
      setOpen(false);
      setEmail(""); setPassword(""); setName(""); setRole("operator");
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openEditUser = (u: Profile) => {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role || "operator");
    setEditActive(u.active);
    setEditEmail(u.email);
    setEditPassword("");
  };

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 6) return "Password must be at least 6 characters long.";
    if (pwd.length > 128) return "Password must be at most 128 characters long.";
    return null;
  };

  const handleEditUser = async () => {
    if (!editUser) return;

    const trimmedPassword = editPassword.trim();
    if (trimmedPassword) {
      const pwdError = validatePassword(trimmedPassword);
      if (pwdError) {
        toast({ title: "Invalid password", description: pwdError, variant: "destructive" });
        return;
      }
    }

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
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setEditLoading(false);
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
      fetchUsers();
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
        {/* ===== AUTH USERS SECTION ===== */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">User Management</h2>
            <p className="text-muted-foreground">Create and manage login accounts</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><UserPlus className="h-4 w-4 mr-2" />New User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateUser} className="space-y-4" autoComplete="off">
                <div className="space-y-2"><Label>Full Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div className="space-y-2"><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></div>
                <div className="space-y-2">
                  <Label>Role</Label>
                   <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {currentRole === "admin" && <SelectItem value="operator">Operator</SelectItem>}
                      <SelectItem value="engineer">Engineer</SelectItem>
                      {currentRole === "admin" && <SelectItem value="manager">Manager</SelectItem>}
                      {currentRole === "admin" && <SelectItem value="admin">Admin</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating..." : "Create User"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader><CardTitle>Login Accounts</CardTitle></CardHeader>
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
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <RoleIcon className="h-4 w-4" />
                          <Badge variant="outline" className={
                            user.role === "admin" ? "bg-red-100 text-red-800 border-red-200" :
                            user.role === "manager" ? "bg-purple-100 text-purple-800 border-purple-200" :
                            user.role === "engineer" ? "bg-blue-100 text-blue-800 border-blue-200" :
                            "bg-gray-100 text-gray-800 border-gray-200"
                          }>
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
                          <Button size="icon" variant="ghost" onClick={() => openEditUser(user)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!isCurrentUser && !(currentRole === "manager" && (user.role === "manager" || user.role === "admin")) && (
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

        {/* ===== ENGINEERS (PIN IDENTITIES) SECTION ===== */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Engineers (PIN Identity)</h2>
            <p className="text-muted-foreground">Manage engineer identities for PIN-based actions</p>
          </div>
          <Dialog open={engOpen} onOpenChange={setEngOpen}>
            <DialogTrigger asChild>
              <Button><KeyRound className="h-4 w-4 mr-2" />New Engineer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Engineer Identity</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateEngineer} className="space-y-4" autoComplete="off">
                <div className="space-y-2"><Label>Engineer Name</Label><Input value={engName} onChange={(e) => setEngName(e.target.value)} required /></div>
                <div className="space-y-2">
                  <Label>PIN (4 digits)</Label>
                  <Input type="password" value={engPin} onChange={(e) => setEngPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 1234" minLength={4} maxLength={4} required />
                </div>
                <Button type="submit" className="w-full" disabled={engLoading || engPin.length < 4}>
                  {engLoading ? "Creating..." : "Create Engineer"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
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
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No engineers configured. Add engineers to enable PIN-based actions.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Edit User Dialog */}
        <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Full Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Leave blank to keep current" minLength={6} maxLength={128} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operator">Operator</SelectItem>
                    <SelectItem value="engineer">Engineer</SelectItem>
                    {currentRole === "admin" && <SelectItem value="manager">Manager</SelectItem>}
                    {currentRole === "admin" && <SelectItem value="admin">Admin</SelectItem>}
                  </SelectContent>
                </Select>
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
