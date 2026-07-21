import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkOrders, useCreateWorkOrder } from "@/hooks/useWorkOrders";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Package, Plus, LogOut, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ComboboxInput } from "@/components/ComboboxInput";

const WAREHOUSE_LOCATIONS = ["AC1", "AC2 - Warehouse", "K53", "Depot RD"];

export default function WarehouseDashboard() {
  const { toast } = useToast();
  const { profile, signOut } = useAuth();
  const { data: workOrders, isLoading } = useWorkOrders();
  const createWO = useCreateWorkOrder();

  const [open, setOpen] = useState(false);
  const [requester, setRequester] = useState(profile?.name ?? "");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  const warehouseWOs = useMemo(
    () => (workOrders ?? []).filter((w: any) => w.wo_type === "warehouse_service"),
    [workOrders],
  );

  const reset = () => {
    setRequester(profile?.name ?? "");
    setLocation("");
    setDescription("");
    setNotes("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requester.trim()) {
      toast({ title: "Requester required", description: "Please enter who is requesting the work order.", variant: "destructive" });
      return;
    }
    if (!location.trim()) {
      toast({ title: "Warehouse location required", description: "Please provide the warehouse location.", variant: "destructive" });
      return;
    }
    if (!description.trim()) {
      toast({ title: "Problem description required", description: "Please describe what needs attention.", variant: "destructive" });
      return;
    }
    try {
      await createWO.mutateAsync({
        requester_name: requester.trim(),
        wo_type: "warehouse_service",
        warehouse_location: location.trim(),
        description: description.trim(),
        notes: notes.trim(),
      } as any);
      toast({ title: "Warehouse Service Request Created" });
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Warehouse Admin</h1>
              <p className="text-xs text-muted-foreground">{profile?.name || profile?.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Warehouse Service Requests</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Create service requests and track their status. These orders never count as line downtime.
              </p>
            </div>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" /> New Request
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Warehouse Service Request</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="requester">Requested by *</Label>
                    <Input id="requester" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Your name" autoComplete="off" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Warehouse location *</Label>
                    <ComboboxInput
                      id="location"
                      value={location}
                      onChange={(v) => setLocation(v)}
                      suggestions={WAREHOUSE_LOCATIONS}
                      placeholder="Select or type a warehouse location"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="desc">Description *</Label>
                    <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs attention?" rows={3} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createWO.isPending}>
                      {createWO.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : warehouseWOs.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No requests yet"
                description="Create your first warehouse service request using the button above."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>WO #</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Requested by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warehouseWOs.map((wo: any) => (
                      <TableRow key={wo.id}>
                        <TableCell className="font-mono text-xs">
                          WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
                        </TableCell>
                        <TableCell>{wo.warehouse_location || "—"}</TableCell>
                        <TableCell className="max-w-[280px] truncate">{wo.description}</TableCell>
                        <TableCell>{wo.requester_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{wo.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(wo.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
