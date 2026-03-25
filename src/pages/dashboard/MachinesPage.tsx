import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, Cog, History } from "lucide-react";
import { useMachines, useAddMachine, useUpdateMachine, useDeleteMachine, type Machine } from "@/hooks/useMachines";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent } from "@/hooks/useAuditLogs";

export default function MachinesPage() {
  const { data: machines, isLoading } = useMachines();
  const addMachine = useAddMachine();
  const updateMachine = useUpdateMachine();
  const deleteMachine = useDeleteMachine();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [editMachine, setEditMachine] = useState<Machine | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [sector, setSector] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("active");

  const resetForm = () => { setName(""); setLine(""); setSector(""); setCode(""); setStatus("active"); };

  const openEdit = (m: Machine) => {
    setEditMachine(m);
    setName(m.name);
    setLine(m.line || "");
    setSector(m.sector || "");
    setCode(m.code || "");
    setStatus(m.status || "active");
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      const result = await addMachine.mutateAsync({ name: name.trim(), line: line.trim(), sector: sector.trim(), code: code.trim(), status });
      toast({ title: "Machine added" });
      logAuditEvent("create", "machine", (result as any)?.id, { name: name.trim() });
      setShowAdd(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editMachine || !name.trim()) return;
    try {
      await updateMachine.mutateAsync({ id: editMachine.id, name: name.trim(), line: line.trim(), sector: sector.trim(), code: code.trim(), status });
      toast({ title: "Machine updated" });
      logAuditEvent("update", "machine", editMachine.id, { name: name.trim() });
      setEditMachine(null);
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMachine.mutateAsync(deleteId);
      toast({ title: "Machine deleted" });
      logAuditEvent("delete", "machine", deleteId);
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const formContent = (
    <div className="space-y-4">
      <div className="space-y-2"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Machine name" required /></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Line</Label><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="e.g. Line 1" /></div>
        <div className="space-y-2"><Label>Sector</Label><Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. Packaging" /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. MCH-001" /></div>
        <div className="space-y-2"><Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Cog className="h-6 w-6" /> Machines</h2>
            <p className="text-muted-foreground">Manage machines available for work orders</p>
          </div>
          <Button onClick={() => { resetForm(); setShowAdd(true); }}><Plus className="h-4 w-4 mr-2" /> Add Machine</Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !machines?.length ? (
              <p className="text-muted-foreground text-center py-8">No machines yet. Add one to get started.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machines.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>{m.line || "—"}</TableCell>
                      <TableCell>{m.sector || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{m.code || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={m.status === "active" ? "default" : m.status === "maintenance" ? "secondary" : "outline"}>
                          {m.status || "active"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(m.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Add Dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Machine</DialogTitle><DialogDescription className="sr-only">Add a new machine to the system</DialogDescription></DialogHeader>
            {formContent}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={addMachine.isPending}>
                {addMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editMachine} onOpenChange={(open) => { if (!open) { setEditMachine(null); resetForm(); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Machine</DialogTitle><DialogDescription className="sr-only">Edit machine details</DialogDescription></DialogHeader>
            {formContent}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditMachine(null); resetForm(); }}>Cancel</Button>
              <Button onClick={handleEdit} disabled={updateMachine.isPending}>
                {updateMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete machine?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently remove this machine. Work orders referencing it will keep their current value.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
