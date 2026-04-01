import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, AlertTriangle, ClipboardList } from "lucide-react";
import { useProblemDescriptions, useAddProblemDescription, useUpdateProblemDescription, useDeleteProblemDescription, type ProblemDescription } from "@/hooks/useProblemDescriptions";
import { useChecklistsByProblem, useAddChecklist, useDeleteChecklist, type ChecklistItem } from "@/hooks/useChecklists";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent } from "@/hooks/useAuditLogs";

const RISK_LEVELS = [
  { value: "low", label: "Low", className: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "medium", label: "Medium", className: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "high", label: "High", className: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "critical", label: "Critical", className: "bg-red-100 text-red-700 border-red-200" },
];

const CHECKLIST_TYPES = ["Health", "Safety", "Machine"];

const riskBadgeClass = (severity: string) => {
  const found = RISK_LEVELS.find((r) => r.value === severity);
  return found?.className || "bg-blue-100 text-blue-700 border-blue-200";
};

// Checklist management sub-component
function ChecklistManager({ problemId }: { problemId: string }) {
  const { data: checklists, isLoading } = useChecklistsByProblem(problemId);
  const addChecklist = useAddChecklist();
  const deleteChecklist = useDeleteChecklist();
  const { toast } = useToast();

  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState("");
  const [newRequired, setNewRequired] = useState(true);

  const handleAdd = async () => {
    if (!newDesc.trim()) return;
    try {
      await addChecklist.mutateAsync({
        problem_description_id: problemId,
        type: newType,
        description: newDesc.trim(),
        is_required: newRequired,
      });
      setNewDesc("");
      toast({ title: "Checklist item added" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteChecklist.mutateAsync(id);
      toast({ title: "Item removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 border-t pt-4 mt-4">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <ClipboardList className="h-4 w-4" /> Checklist Items
      </h4>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : checklists && checklists.length > 0 ? (
        <div className="space-y-1.5">
          {checklists.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm bg-muted/50 rounded px-2 py-1.5">
              <Badge variant="outline" className="text-xs shrink-0">{c.type}</Badge>
              <span className="flex-1">{c.description}</span>
              {c.is_required && <span className="text-destructive text-xs font-medium">Required</span>}
              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDelete(c.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No checklist items. Static defaults will be used.</p>
      )}

      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[150px]">
          <Input
            placeholder="Checklist item description..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <Select value={newType} onValueChange={setNewType}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue placeholder="Select type..." />
          </SelectTrigger>
          <SelectContent>
            {CHECKLIST_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Checkbox checked={newRequired} onCheckedChange={(c) => setNewRequired(!!c)} id="cl-req" />
          <Label htmlFor="cl-req" className="text-xs cursor-pointer">Required</Label>
        </div>
        <Button size="sm" className="h-8" onClick={handleAdd} disabled={!newDesc.trim() || addChecklist.isPending}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

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
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [active, setActive] = useState(true);

  const resetForm = () => { setName(""); setCategory(""); setDescription(""); setSeverity("medium"); setActive(true); };

  const openEdit = (p: ProblemDescription) => {
    setEditProblem(p);
    setName(p.name);
    setCategory(p.category || "");
    setDescription(p.description || "");
    setSeverity(p.severity || "medium");
    setActive(p.active !== false);
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      const result = await addProblem.mutateAsync({ name: name.trim(), category: category.trim(), description: description.trim(), severity, active });
      toast({ title: "Problem added" });
      logAuditEvent("create", "problem", (result as any)?.id, { name: name.trim() });
      setShowAdd(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editProblem || !name.trim()) return;
    try {
      await updateProblem.mutateAsync({ id: editProblem.id, name: name.trim(), category: category.trim(), description: description.trim(), severity, active });
      toast({ title: "Problem updated" });
      logAuditEvent("update", "problem", editProblem.id, { name: name.trim() });
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
      logAuditEvent("delete", "problem", deleteId);
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
      <div className="space-y-2"><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electrical" /></div>
      <div className="space-y-2">
        <Label>Risk Level</Label>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger><SelectValue placeholder="Select risk level..." /></SelectTrigger>
          <SelectContent>
            {RISK_LEVELS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
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
            <p className="text-muted-foreground">Manage standardized problem descriptions and checklists for work orders</p>
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
                    <TableHead>Risk Level</TableHead>
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
                        <Badge variant="outline" className={riskBadgeClass(p.severity)}>
                          {RISK_LEVELS.find((r) => r.value === p.severity)?.label || "Medium"}
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

        {/* Add Dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Problem</DialogTitle><DialogDescription className="sr-only">Add a new problem description</DialogDescription></DialogHeader>
            {formContent}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={addProblem.isPending}>
                {addProblem.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog with Checklist Management */}
        <Dialog open={!!editProblem} onOpenChange={(open) => { if (!open) { setEditProblem(null); resetForm(); } }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Problem</DialogTitle><DialogDescription className="sr-only">Edit problem details and checklists</DialogDescription></DialogHeader>
            {formContent}
            {editProblem && <ChecklistManager problemId={editProblem.id} />}
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
              <AlertDialogDescription>This will permanently remove this problem description and its checklists.</AlertDialogDescription>
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
