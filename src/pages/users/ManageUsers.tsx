import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Shield, Wrench as WrenchIcon, HardHat, Pencil, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"] & { role?: AppRole };

const roleLabels: Record<AppRole, string> = { admin: "Manager", engineer: "Engineer", operator: "Operator" };
const roleIcons: Record<AppRole, React.ComponentType<{ className?: string }>> = {
  admin: Shield,
  engineer: WrenchIcon,
  operator: HardHat,
};

export default function ManageUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("operator");
  const [shift, setShift] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Edit user state
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<AppRole>("operator");
  const [editShift, setEditShift] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);

  const fetchUsers = async () => {
    const { data: profiles } = await supabase.from("profiles").select("*");
    if (!profiles) return;
    const { data: roles } = await supabase.from("user_roles").select("*");
    const roleMap = new Map(roles?.map((r) => [r.user_id, r.role]));
    setUsers(profiles.map((p) => ({ ...p, role: roleMap.get(p.id) })));
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await supabase.functions.invoke("create-user", {
        body: { email: email.trim().toLowerCase(), password, name: name.trim(), role, shift: role === "engineer" ? shift : null },
      });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast({ title: "User created", description: `${name} has been added as ${roleLabels[role]}` });
      setOpen(false);
      setEmail(""); setPassword(""); setName(""); setRole("operator"); setShift("");
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
    setEditShift(u.shift || "");
    setEditActive(u.active);
  };

  const handleEditUser = async () => {
    if (!editUser) return;
    setEditLoading(true);
    try {
      const res = await supabase.functions.invoke("update-user", {
        body: { userId: editUser.id, name: editName.trim(), role: editRole, shift: editRole === "engineer" ? editShift : null, active: editActive },
      });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);
      toast({ title: "User updated" });
      setEditUser(null);
      fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">User Management</h2>
            <p className="text-muted-foreground">Create and manage system users</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><UserPlus className="h-4 w-4 mr-2" />New User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="space-y-2"><Label>Full Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div className="space-y-2"><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operator">Operator</SelectItem>
                      <SelectItem value="engineer">Engineer</SelectItem>
                      <SelectItem value="admin">Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {role === "engineer" && (
                  <div className="space-y-2">
                    <Label>Shift</Label>
                    <Select value={shift} onValueChange={setShift}>
                      <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="morning">Morning</SelectItem>
                        <SelectItem value="afternoon">Afternoon</SelectItem>
                        <SelectItem value="night">Night</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating..." : "Create User"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader><CardTitle>All Users</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const RoleIcon = user.role ? roleIcons[user.role] : Shield;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <RoleIcon className="h-4 w-4" />
                          {user.role ? roleLabels[user.role] : "No role"}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{user.shift || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={user.active ? "default" : "secondary"}>
                          {user.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => openEditUser(user)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No users found</TableCell>
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
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operator">Operator</SelectItem>
                    <SelectItem value="engineer">Engineer</SelectItem>
                    <SelectItem value="admin">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editRole === "engineer" && (
                <div className="space-y-2">
                  <Label>Shift</Label>
                  <Select value={editShift} onValueChange={setEditShift}>
                    <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">Morning</SelectItem>
                      <SelectItem value="afternoon">Afternoon</SelectItem>
                      <SelectItem value="night">Night</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
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
      </div>
    </DashboardLayout>
  );
}
