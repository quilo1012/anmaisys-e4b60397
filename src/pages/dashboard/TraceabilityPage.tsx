import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GitBranch, Search, Plus, Trash2, Factory, FlaskConical, Truck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const MANAGE_ROLES = ["admin", "manager", "supervisor", "quality_supervisor", "planner", "warehouse"];

interface RawLot {
  id: string; material_name: string; supplier_name: string | null; supplier_lot: string | null;
  received_on: string | null; quantity: number | null; unit: string | null; expiry_date: string | null; coa_ref: string | null; notes: string | null;
}
interface Usage { id: string; batch_code: string; raw_material_lot_id: string; quantity_used: number | null; unit: string | null; notes: string | null; raw_material_lots?: RawLot | null }
interface Dispatch { id: string; batch_code: string; customer_name: string; dispatch_date: string | null; quantity: number | null; unit: string | null; reference: string | null; notes: string | null }
interface ProdRow {
  actual_qty: number | null; blender_ref: string | null; sku_code_text: string | null;
  production_sessions: { line: string | null; session_date: string | null; shift: string | null; leader_name: string | null } | null;
  sku_products: { code: string | null; description: string | null } | null;
}

export default function TraceabilityPage() {
  const { role } = useAuth();
  const canManage = MANAGE_ROLES.includes(role ?? "");
  const qc = useQueryClient();

  const [tab, setTab] = useState<"trace" | "lots">("trace");
  const [batchInput, setBatchInput] = useState("");
  const [batch, setBatch] = useState("");

  // Dialogs
  const [lotOpen, setLotOpen] = useState(false);
  const [lotForm, setLotForm] = useState<Partial<RawLot>>({});
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageForm, setUsageForm] = useState<{ raw_material_lot_id: string; quantity_used: string; unit: string }>({ raw_material_lot_id: "", quantity_used: "", unit: "" });
  const [dispOpen, setDispOpen] = useState(false);
  const [dispForm, setDispForm] = useState<{ customer_name: string; dispatch_date: string; quantity: string; unit: string; reference: string }>({ customer_name: "", dispatch_date: format(new Date(), "yyyy-MM-dd"), quantity: "", unit: "", reference: "" });

  const anyTable = (t: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables not in generated types yet
    supabase.from(t as any);

  const { data: lots = [] } = useQuery({
    queryKey: ["raw_material_lots"],
    queryFn: async () => {
      const { data, error } = await anyTable("raw_material_lots").select("*").order("received_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RawLot[];
    },
  });

  const { data: production = [] } = useQuery({
    queryKey: ["trace_production", batch],
    enabled: !!batch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_items")
        .select("actual_qty, blender_ref, sku_code_text, production_sessions(line, session_date, shift, leader_name), sku_products(code, description)")
        .eq("blender_ref", batch);
      if (error) throw error;
      return (data ?? []) as unknown as ProdRow[];
    },
  });
  const { data: usage = [] } = useQuery({
    queryKey: ["trace_usage", batch],
    enabled: !!batch,
    queryFn: async () => {
      const { data, error } = await anyTable("batch_material_usage").select("*, raw_material_lots(*)").eq("batch_code", batch).order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Usage[];
    },
  });
  const { data: dispatch = [] } = useQuery({
    queryKey: ["trace_dispatch", batch],
    enabled: !!batch,
    queryFn: async () => {
      const { data, error } = await anyTable("batch_dispatch").select("*").eq("batch_code", batch).order("dispatch_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Dispatch[];
    },
  });

  const doSearch = () => setBatch(batchInput.trim());

  // ---- Raw lot save ----
  const saveLot = useMutation({
    mutationFn: async () => {
      if (!lotForm.material_name?.trim()) throw new Error("Material name is required");
      const payload = {
        material_name: lotForm.material_name.trim(), supplier_name: lotForm.supplier_name || null, supplier_lot: lotForm.supplier_lot || null,
        received_on: lotForm.received_on || null, quantity: lotForm.quantity ?? null, unit: lotForm.unit || null,
        expiry_date: lotForm.expiry_date || null, coa_ref: lotForm.coa_ref || null, notes: lotForm.notes || null,
      };
      if (lotForm.id) { const { error } = await anyTable("raw_material_lots").update(payload as never).eq("id", lotForm.id); if (error) throw error; }
      else { const { error } = await anyTable("raw_material_lots").insert(payload as never); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["raw_material_lots"] }); setLotOpen(false); toast.success("Lot saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addUsage = useMutation({
    mutationFn: async () => {
      if (!usageForm.raw_material_lot_id) throw new Error("Pick a raw material lot");
      const { error } = await anyTable("batch_material_usage").insert({
        batch_code: batch, raw_material_lot_id: usageForm.raw_material_lot_id,
        quantity_used: usageForm.quantity_used === "" ? null : Number(usageForm.quantity_used), unit: usageForm.unit || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trace_usage", batch] }); setUsageOpen(false); setUsageForm({ raw_material_lot_id: "", quantity_used: "", unit: "" }); toast.success("Material linked"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delUsage = useMutation({
    mutationFn: async (id: string) => { const { error } = await anyTable("batch_material_usage").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trace_usage", batch] }),
  });

  const addDispatch = useMutation({
    mutationFn: async () => {
      if (!dispForm.customer_name.trim()) throw new Error("Customer is required");
      const { error } = await anyTable("batch_dispatch").insert({
        batch_code: batch, customer_name: dispForm.customer_name.trim(), dispatch_date: dispForm.dispatch_date || null,
        quantity: dispForm.quantity === "" ? null : Number(dispForm.quantity), unit: dispForm.unit || null, reference: dispForm.reference || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trace_dispatch", batch] }); setDispOpen(false); setDispForm({ customer_name: "", dispatch_date: format(new Date(), "yyyy-MM-dd"), quantity: "", unit: "", reference: "" }); toast.success("Dispatch added"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delDispatch = useMutation({
    mutationFn: async (id: string) => { const { error } = await anyTable("batch_dispatch").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trace_dispatch", batch] }),
  });

  const prodHead = useMemo(() => production[0], [production]);

  const tabBtn = (t: "trace" | "lots", label: string) => (
    <button type="button" onClick={() => setTab(t)}
      className={cn("rounded px-4 py-1.5 text-sm font-medium transition-colors", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Traceability</h1>
          </div>
          <div className="inline-flex rounded-md border p-0.5">
            {tabBtn("trace", "Trace")}
            {tabBtn("lots", "Received lots")}
          </div>
        </div>

        {tab === "trace" ? (
          <div className="space-y-4">
            <Card>
              <CardContent className="flex flex-wrap items-end gap-2 p-4">
                <div className="flex-1 min-w-[12rem]">
                  <Label>Batch code</Label>
                  <Input value={batchInput} onChange={(e) => setBatchInput(e.target.value)} placeholder="e.g. CRE1KG-2401"
                    onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }} />
                </div>
                <Button onClick={doSearch}><Search className="mr-1 h-4 w-4" />Trace</Button>
              </CardContent>
            </Card>

            {batch && (
              <>
                {/* Production */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Factory className="h-4 w-4" /> Finished batch <span className="font-mono">{batch}</span></CardTitle></CardHeader>
                  <CardContent>
                    {production.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No production record found for this batch code.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                        <div><span className="text-muted-foreground">SKU: </span>{prodHead?.sku_products?.code ?? prodHead?.sku_code_text ?? "—"}</div>
                        <div><span className="text-muted-foreground">Product: </span>{prodHead?.sku_products?.description ?? "—"}</div>
                        <div><span className="text-muted-foreground">Line: </span>{prodHead?.production_sessions?.line ?? "—"}</div>
                        <div><span className="text-muted-foreground">Date: </span>{prodHead?.production_sessions?.session_date ?? "—"}</div>
                        <div><span className="text-muted-foreground">Shift: </span>{prodHead?.production_sessions?.shift ?? "—"}</div>
                        <div><span className="text-muted-foreground">Leader: </span>{prodHead?.production_sessions?.leader_name ?? "—"}</div>
                        <div><span className="text-muted-foreground">Qty: </span>{production.reduce((s, p) => s + (p.actual_qty ?? 0), 0)}</div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Materials used */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> Raw materials used ({usage.length})</CardTitle>
                    {canManage && <Button size="sm" variant="outline" onClick={() => setUsageOpen(true)}><Plus className="mr-1 h-4 w-4" />Add material</Button>}
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Supplier</TableHead><TableHead>Supplier lot</TableHead><TableHead>Qty used</TableHead><TableHead>Expiry</TableHead>{canManage && <TableHead />}</TableRow></TableHeader>
                      <TableBody>
                        {usage.length === 0 && <TableRow><TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground">No materials linked</TableCell></TableRow>}
                        {usage.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell>{u.raw_material_lots?.material_name ?? "—"}</TableCell>
                            <TableCell>{u.raw_material_lots?.supplier_name ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{u.raw_material_lots?.supplier_lot ?? "—"}</TableCell>
                            <TableCell>{u.quantity_used ?? "—"}{u.unit ? ` ${u.unit}` : ""}</TableCell>
                            <TableCell>{u.raw_material_lots?.expiry_date ?? "—"}</TableCell>
                            {canManage && <TableCell><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => delUsage.mutate(u.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Dispatch */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" /> Customers / dispatch ({dispatch.length})</CardTitle>
                    {canManage && <Button size="sm" variant="outline" onClick={() => setDispOpen(true)}><Plus className="mr-1 h-4 w-4" />Add dispatch</Button>}
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Qty</TableHead><TableHead>Reference</TableHead>{canManage && <TableHead />}</TableRow></TableHeader>
                      <TableBody>
                        {dispatch.length === 0 && <TableRow><TableCell colSpan={canManage ? 5 : 4} className="text-center text-muted-foreground">No dispatch records</TableCell></TableRow>}
                        {dispatch.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell>{d.customer_name}</TableCell>
                            <TableCell>{d.dispatch_date ?? "—"}</TableCell>
                            <TableCell>{d.quantity ?? "—"}{d.unit ? ` ${d.unit}` : ""}</TableCell>
                            <TableCell>{d.reference ?? "—"}</TableCell>
                            {canManage && <TableCell><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => delDispatch.mutate(d.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        ) : (
          /* Received lots tab */
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Raw material lots ({lots.length})</CardTitle>
              {canManage && <Button onClick={() => { setLotForm({}); setLotOpen(true); }}><Plus className="mr-1 h-4 w-4" />Add lot</Button>}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Supplier</TableHead><TableHead>Supplier lot</TableHead><TableHead>Received</TableHead><TableHead>Qty</TableHead><TableHead>Expiry</TableHead><TableHead>COA</TableHead></TableRow></TableHeader>
                <TableBody>
                  {lots.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No lots recorded</TableCell></TableRow>}
                  {lots.map((l) => (
                    <TableRow key={l.id} className={cn(canManage && "cursor-pointer")} onClick={() => { if (canManage) { setLotForm(l); setLotOpen(true); } }}>
                      <TableCell>{l.material_name}</TableCell>
                      <TableCell>{l.supplier_name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.supplier_lot ?? "—"}</TableCell>
                      <TableCell>{l.received_on ?? "—"}</TableCell>
                      <TableCell>{l.quantity ?? "—"}{l.unit ? ` ${l.unit}` : ""}</TableCell>
                      <TableCell>{l.expiry_date ?? "—"}</TableCell>
                      <TableCell>{l.coa_ref ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Raw lot dialog */}
        <Dialog open={lotOpen} onOpenChange={setLotOpen}>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader><DialogTitle>{lotForm.id ? "Edit lot" : "New raw material lot"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Material name *</Label><Input value={lotForm.material_name ?? ""} onChange={(e) => setLotForm({ ...lotForm, material_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Supplier</Label><Input value={lotForm.supplier_name ?? ""} onChange={(e) => setLotForm({ ...lotForm, supplier_name: e.target.value })} /></div>
                <div><Label>Supplier lot</Label><Input value={lotForm.supplier_lot ?? ""} onChange={(e) => setLotForm({ ...lotForm, supplier_lot: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Received</Label><Input type="date" value={lotForm.received_on ?? ""} onChange={(e) => setLotForm({ ...lotForm, received_on: e.target.value })} /></div>
                <div><Label>Quantity</Label><Input type="number" value={lotForm.quantity ?? ""} onChange={(e) => setLotForm({ ...lotForm, quantity: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div><Label>Unit</Label><Input value={lotForm.unit ?? ""} onChange={(e) => setLotForm({ ...lotForm, unit: e.target.value })} placeholder="kg" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Expiry</Label><Input type="date" value={lotForm.expiry_date ?? ""} onChange={(e) => setLotForm({ ...lotForm, expiry_date: e.target.value })} /></div>
                <div><Label>COA ref</Label><Input value={lotForm.coa_ref ?? ""} onChange={(e) => setLotForm({ ...lotForm, coa_ref: e.target.value })} /></div>
              </div>
              <div><Label>Notes</Label><Textarea value={lotForm.notes ?? ""} onChange={(e) => setLotForm({ ...lotForm, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => saveLot.mutate()} disabled={saveLot.isPending}>{saveLot.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add material used dialog */}
        <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Link raw material to {batch}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Raw material lot</Label>
                <Select value={usageForm.raw_material_lot_id} onValueChange={(v) => setUsageForm({ ...usageForm, raw_material_lot_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick a received lot" /></SelectTrigger>
                  <SelectContent>
                    {lots.length === 0 && <SelectItem value="__none__" disabled>No lots — add one first</SelectItem>}
                    {lots.map((l) => <SelectItem key={l.id} value={l.id}>{l.material_name}{l.supplier_lot ? ` · ${l.supplier_lot}` : ""}{l.supplier_name ? ` (${l.supplier_name})` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Quantity used</Label><Input type="number" value={usageForm.quantity_used} onChange={(e) => setUsageForm({ ...usageForm, quantity_used: e.target.value })} /></div>
                <div><Label>Unit</Label><Input value={usageForm.unit} onChange={(e) => setUsageForm({ ...usageForm, unit: e.target.value })} placeholder="kg" /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={() => addUsage.mutate()} disabled={addUsage.isPending}>Add</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add dispatch dialog */}
        <Dialog open={dispOpen} onOpenChange={setDispOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add dispatch for {batch}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Customer *</Label><Input value={dispForm.customer_name} onChange={(e) => setDispForm({ ...dispForm, customer_name: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Date</Label><Input type="date" value={dispForm.dispatch_date} onChange={(e) => setDispForm({ ...dispForm, dispatch_date: e.target.value })} /></div>
                <div><Label>Quantity</Label><Input type="number" value={dispForm.quantity} onChange={(e) => setDispForm({ ...dispForm, quantity: e.target.value })} /></div>
                <div><Label>Unit</Label><Input value={dispForm.unit} onChange={(e) => setDispForm({ ...dispForm, unit: e.target.value })} /></div>
              </div>
              <div><Label>Reference (PO / invoice)</Label><Input value={dispForm.reference} onChange={(e) => setDispForm({ ...dispForm, reference: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => addDispatch.mutate()} disabled={addDispatch.isPending}>Add</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
