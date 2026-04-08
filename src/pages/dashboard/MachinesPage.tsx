import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, Cog, History, MapPin, QrCode } from "lucide-react";
import { useMachines, useAddMachine, useUpdateMachine, useDeleteMachine, useMoveMachine, STATUS_OPTIONS, type Machine } from "@/hooks/useMachines";

import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";

export default function MachinesPage() {
  const { data: machines, isLoading } = useMachines();
  const addMachine = useAddMachine();
  const updateMachine = useUpdateMachine();
  const deleteMachine = useDeleteMachine();
  const moveMachine = useMoveMachine();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [showAdd, setShowAdd] = useState(false);
  const [editMachine, setEditMachine] = useState<Machine | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<Machine | null>(null);
  const [moveLocation, setMoveLocation] = useState("");
  const [qrMachine, setQrMachine] = useState<Machine | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [sector, setSector] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("active");
  const [machineType, setMachineType] = useState("");
  const [currentLocation, setCurrentLocation] = useState("");


  const resetForm = () => { setName(""); setLine(""); setSector(""); setCode(""); setStatus("active"); setMachineType(""); setCurrentLocation(""); setErrors({}); };

  const openEdit = (m: Machine) => {
    setEditMachine(m);
    setName(m.name); setLine(m.line || ""); setSector(m.sector || ""); setCode(m.code || "");
    setStatus(m.status || "active"); setMachineType(m.machine_type || ""); setCurrentLocation(m.current_location || "");
    setErrors({});
  };

  const validate = (isEdit = false): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required";
    if (!machineType.trim()) e.machineType = "Type is required";
    if (!currentLocation.trim()) e.currentLocation = "Location is required";
    if (!code.trim()) e.code = "Code is required";
    if (code.trim() && machines) {
      const dup = machines.find(m => m.code === code.trim() && (!isEdit || m.id !== editMachine?.id));
      if (dup) e.code = "Code already in use";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleAdd = async () => {
    if (!validate()) return;
    try {
      const result = await addMachine.mutateAsync({ name: name.trim(), line: line.trim(), sector: sector.trim(), code: code.trim(), status, machine_type: machineType.trim(), current_location: currentLocation.trim() });
      toast({ title: "Machine added" });
      logAuditEvent("create", "machine", (result as any)?.id, { name: name.trim() });
      setShowAdd(false); resetForm();
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const handleEdit = async () => {
    if (!editMachine || !validate(true)) return;
    try {
      await updateMachine.mutateAsync({ id: editMachine.id, name: name.trim(), line: line.trim(), sector: sector.trim(), code: code.trim(), status, machine_type: machineType.trim(), current_location: currentLocation.trim() });
      toast({ title: "Machine updated" });
      logAuditEvent("update", "machine", editMachine.id, { name: name.trim() });
      setEditMachine(null); resetForm();
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMachine.mutateAsync(deleteId);
      toast({ title: "Machine deleted" });
      logAuditEvent("delete", "machine", deleteId);
      setDeleteId(null);
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const handleMove = async () => {
    if (!moveTarget || !moveLocation.trim()) return;
    try {
      await moveMachine.mutateAsync({ machineId: moveTarget.id, fromLocation: moveTarget.current_location || "", toLocation: moveLocation.trim() });
      toast({ title: "Machine moved", description: `${moveTarget.name} → ${moveLocation.trim()}` });
      logAuditEvent("move", "machine", moveTarget.id, { from: moveTarget.current_location, to: moveLocation.trim() });
      setMoveTarget(null); setMoveLocation("");
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const formContent = (
    <div className="space-y-5">
      {/* General Info */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">General Info</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Machine name" />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Code *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MCH-001" className="font-mono" />
            {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
          </div>
        </div>
      </div>

      {/* Classification */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Classification</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Machine Type *</Label>
            <Input value={machineType} onChange={(e) => setMachineType(e.target.value)} placeholder="e.g. CNC, Press, Conveyor" />
            {errors.machineType && <p className="text-xs text-destructive">{errors.machineType}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Location */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Location</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Current Location *</Label>
            <Input value={currentLocation} onChange={(e) => setCurrentLocation(e.target.value)} placeholder="e.g. Building A, Floor 2" />
            {errors.currentLocation && <p className="text-xs text-destructive">{errors.currentLocation}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Line</Label>
            <Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="e.g. Line 1, Line A" />
          </div>
        </div>
        <div className="mt-4">
          <div className="space-y-1.5 max-w-[calc(50%-0.5rem)]">
            <Label>Sector</Label>
            <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. Packaging" />
          </div>
        </div>
      </div>
    </div>
  );

  const statusBadge = (s: string) => {
    const map: Record<string, "default" | "secondary" | "outline" | "destructive"> = { active: "default", in_use: "secondary", maintenance: "destructive", idle: "outline" };
    return <Badge variant={map[s] || "outline"}>{STATUS_OPTIONS.find(o => o.value === s)?.label || s || "Active"}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Cog className="h-6 w-6" /> Machines</h2>
            <p className="text-muted-foreground">Manage machines, locations, and types</p>
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Maint.</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {machines.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>{m.machine_type || "—"}</TableCell>
                        <TableCell>
                          {m.current_location ? (
                            <Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" />{m.current_location}</Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>{m.line || "—"}</TableCell>
                        <TableCell className="font-mono text-sm">{m.code || "—"}</TableCell>
                        <TableCell>{statusBadge(m.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.last_maintenance_date ? format(new Date(m.last_maintenance_date), "dd/MM/yyyy") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)} title="History"><History className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => { setMoveTarget(m); setMoveLocation(""); }} title="Move"><MapPin className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => setQrMachine(m)} title="QR Code"><QrCode className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(m.id)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add Dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Add Machine</DialogTitle><DialogDescription className="sr-only">Add a new machine</DialogDescription></DialogHeader>{formContent}
            <DialogFooter><Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleAdd} disabled={addMachine.isPending}>{addMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editMachine} onOpenChange={(o) => { if (!o) { setEditMachine(null); resetForm(); } }}>
          <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Edit Machine</DialogTitle><DialogDescription className="sr-only">Edit machine details</DialogDescription></DialogHeader>{formContent}
            <DialogFooter><Button variant="outline" onClick={() => { setEditMachine(null); resetForm(); }}>Cancel</Button><Button onClick={handleEdit} disabled={updateMachine.isPending}>{updateMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Move Dialog */}
        <Dialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Move Machine</DialogTitle><DialogDescription>Move {moveTarget?.name} to a new location</DialogDescription></DialogHeader>
            <div className="space-y-4">
              <div><Label className="text-sm text-muted-foreground">Current Location</Label><p className="font-medium">{moveTarget?.current_location || "Not assigned"}</p></div>
              <div className="space-y-2"><Label>New Location</Label>
                <Input value={moveLocation} onChange={(e) => setMoveLocation(e.target.value)} placeholder="Enter new location" />
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setMoveTarget(null)}>Cancel</Button><Button onClick={handleMove} disabled={moveMachine.isPending || !moveLocation.trim()}>{moveMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Move</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* QR Code Dialog */}
        <Dialog open={!!qrMachine} onOpenChange={(o) => !o && setQrMachine(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>QR Code — {qrMachine?.name}</DialogTitle><DialogDescription>Scan to open machine history or create a Work Order</DialogDescription></DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <QRCodeSVG value={`${window.location.origin}/dashboard/machines/${encodeURIComponent(qrMachine?.name || "")}/history`} size={200} />
              <p className="text-xs text-muted-foreground text-center">Points to machine history page</p>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setQrMachine(null)}>Close</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Delete machine?</AlertDialogTitle><AlertDialogDescription>This will permanently remove this machine.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
