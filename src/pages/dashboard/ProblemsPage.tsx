import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { useProblemDescriptions, useAddProblemDescription, useUpdateProblemDescription, useDeleteProblemDescription, type ProblemDescription } from "@/hooks/useProblemDescriptions";
import { useToast } from "@/hooks/use-toast";

const severityColors: Record<string, string> = {
  low: "bg-green-100 text-green-800 border-green-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-red-100 text-red-800 border-red-200",
};

export default function ProblemsPage() {
  const { data: problems, isLoading } = useProblemDescriptions();
  const addProblem = useAddProblemDescription();
  const updateProblem = useUpdateProblemDescription();
  const deleteProblem = useDeleteProblemDescription();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [editProblem, setEditProblem] = useState<ProblemDescription | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);

  const resetForm = () => { setName(""); setCategory(""); setSeverity("medium"); setDescription(""); setActive(true); };

  const openEdit = (p: ProblemDescription) => {
    setEditProblem(p);
    setName(p.name);
    setCategory(p.category || "");
    setSeverity(p.severity || "medium");
    setDescription(p.description || "");
    setActive(p.active !== false);
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      await addProblem.mutateAsync({ name: name.trim(), category: category.trim(), severity, description: description.trim(), active });
      toast({ title: "Problem added" });
      setShowAdd(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editProblem || !name.trim()) return;
    try {
      await updateProblem.mutateAsync({ id: editProblem.id, name: name.trim(), category: category.trim(), severity, description: description.trim(), active });
      toast({ title: "Problem updated" });
      setEditProblem(null);
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteProblem.mutateAsync(deleteId);
      toast({ title: "Problem deleted" });
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const toggleActive = async (p: ProblemDescription) => {
    try {
      await updateProblem.mutateAsync({ id: p.id, active: !p.active });
      toast({ title: p.active ? "Problem deactivated" : "Problem activated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const formContent = (
    <div className="space-y-4">
      <div className="space-y-2"><Label>Problem Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Motor Overheating" required /></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electrical" /></div>
        <div className="space-y-2"><Label>Severity</Label>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detailed description..." rows={3} /></div>
      <div className="flex items-center gap-2">
        <Switch checked={active} onCheckedChange={setActive} />
        <Label>Active</Label>
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><AlertTriangle className="h-6 w-6" /> Problem Descriptions</h2>
            <p className="text-muted-foreground">Manage standardized problem descriptions for work orders</p>
          </div>
          <Button onClick={() => { resetForm(); setShowAdd(true); }}><Plus className="h-4 w-4 mr-2" /> Add Problem</Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !problems?.length ? (
              <p className="text-muted-foreground text-center py-8">No problems yet. Add one to get started.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {problems.map((p) => (
                    <TableRow key={p.id} className={!p.active ? "opacity-50" : ""}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.category || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={severityColors[p.severity] || severityColors.medium}>
                          {p.severity || "medium"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">{p.description || "—"}</TableCell>
                      <TableCell>
                        <Switch checked={p.active !== false} onCheckedChange={() => toggleActive(p)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(p.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Problem</DialogTitle></DialogHeader>
            {formContent}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={addProblem.isPending}>
                {addProblem.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editProblem} onOpenChange={(open) => { if (!open) { setEditProblem(null); resetForm(); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Problem</DialogTitle></DialogHeader>
            {formContent}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditProblem(null); resetForm(); }}>Cancel</Button>
              <Button onClick={handleEdit} disabled={updateProblem.isPending}>
                {updateProblem.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete problem?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently remove this problem description.</AlertDialogDescription>
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
