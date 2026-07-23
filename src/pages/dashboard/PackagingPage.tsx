import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import XLSX from "xlsx-js-style";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes, Upload, Plus, FileDown, Loader2, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const MANAGE_ROLES = ["admin", "manager", "supervisor", "quality_supervisor", "planner", "warehouse"];
const MATERIAL_TYPES = ["label", "bag", "tub", "lid", "scoop", "box", "other"] as const;
// The Materials tab manages physical components only. Labels & bags live in the Packaging BOM.
const COMPONENT_TYPES = ["tub", "lid", "scoop", "box", "other"] as const;
const PACK_TYPES = ["BAG", "TUB"] as const;

interface Material {
  id: string; material_type: string; barcode: string | null; ap_code: string | null; description: string | null;
  country: string | null; flavour: string | null; size: string | null; pack_type: string | null; active: boolean;
}
interface Order {
  id: string; po_number: string; sku: string | null; description: string | null; country: string | null;
  packaging_type: string | null; qty: number | null; line: string | null; planned_date: string | null; status: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tables not in generated types yet
const tbl = (t: string) => supabase.from(t as any);

function normType(s: string): string {
  const v = s.toLowerCase();
  return (MATERIAL_TYPES as readonly string[]).find((t) => t === v) ?? "other";
}
function normPack(s: string): string | null {
  const v = s.toUpperCase();
  if (v.includes("BAG") || v.includes("SACHET") || v.includes("POUCH")) return "BAG";
  if (v.includes("TUB") || v.includes("POTE") || v.includes("JAR")) return "TUB";
  return null;
}

// ============================================================
export default function PackagingPage() {
  const { role } = useAuth();
  const canManage = MANAGE_ROLES.includes(role ?? "");
  const [tab, setTab] = useState<"materials" | "orders" | "bom">("materials");

  const tabBtn = (t: "materials" | "orders" | "bom", label: string) => (
    <button type="button" onClick={() => setTab(t)}
      className={cn("rounded px-4 py-1.5 text-sm font-medium transition-colors", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Packaging</h1>
          </div>
          <div className="inline-flex rounded-md border p-0.5">
            {tabBtn("materials", "Materials")}
            {tabBtn("bom", "Packaging BOM")}
            {tabBtn("orders", "Production orders")}
          </div>
        </div>

        {tab === "materials" ? <MaterialsView canManage={canManage} />
          : tab === "bom" ? <BomView canManage={canManage} />
          : <OrdersView canManage={canManage} />}
      </div>
    </DashboardLayout>
  );
}

// ============================================================
// Materials
// ============================================================
function MaterialsView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [filterType, setFilterType] = useState("__all__");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Partial<Material>>({});

  const { data: materials = [] } = useQuery({
    queryKey: ["pvs_materials"],
    queryFn: async () => {
      const all: Material[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await tbl("materials").select("*").order("created_at", { ascending: false }).range(from, from + 999);
        if (error) throw error;
        const page = (data ?? []) as unknown as Material[];
        all.push(...page);
        if (page.length < 1000) break;
        from += 1000;
      }
      return all;
    },
  });

  // Materials tab = physical components only (tub/lid/scoop/box). Labels & bags live in the Packaging BOM.
  const components = useMemo(() => materials.filter((m) => m.material_type !== "label" && m.material_type !== "bag"), [materials]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return components.filter((m) =>
      (filterType === "__all__" || m.material_type === filterType) &&
      (!q || [m.barcode, m.ap_code, m.description, m.country, m.flavour, m.size].some((f) => (f ?? "").toLowerCase().includes(q))));
  }, [components, filterType, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of components) c[m.material_type] = (c[m.material_type] ?? 0) + 1;
    return c;
  }, [components]);

  // Only show optional columns that actually carry data (labels have just barcode + description).
  const cols = useMemo(() => ({
    ap_code: filtered.some((m) => m.ap_code),
    country: filtered.some((m) => m.country),
    flavour: filtered.some((m) => m.flavour),
    size: filtered.some((m) => m.size),
  }), [filtered]);
  const colCount = 3 + Object.values(cols).filter(Boolean).length;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.material_type) throw new Error("Material type is required");
      if (!form.barcode && !form.ap_code) throw new Error("A barcode or AP code is required");
      const payload = {
        material_type: form.material_type, barcode: form.barcode || null, ap_code: form.ap_code || null,
        description: form.description || null, country: form.country || null, flavour: form.flavour || null,
        size: form.size || null, pack_type: form.pack_type || null, active: form.active ?? true,
      };
      if (form.id) { const { error } = await tbl("materials").update(payload as never).eq("id", form.id); if (error) throw error; }
      else { const { error } = await tbl("materials").insert({ ...payload, created_by: user?.id ?? null } as never); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pvs_materials"] }); setEditOpen(false); toast.success("Material saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {COMPONENT_TYPES.filter((t) => counts[t]).map((t) => (
            <Badge key={t} variant="secondary" className="text-[11px] capitalize">{t}: {counts[t]}</Badge>
          ))}
          {components.length === 0 && <span className="text-sm text-muted-foreground">No components yet — add tubs, lids, scoops and boxes here. Labels &amp; bags live in the Packaging BOM tab.</span>}
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setGuideOpen(true)}><Upload className="mr-1 h-4 w-4" />Import product guide</Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-1 h-4 w-4" />Import</Button>
            <Button onClick={() => { setForm({ material_type: "tub", active: true }); setEditOpen(true); }}><Plus className="mr-1 h-4 w-4" />Add material</Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All Types</SelectItem>{COMPONENT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product name or barcode…" className="w-72" />
      </div>

      <Card>
        <CardHeader><CardTitle>Materials ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Type</TableHead><TableHead>Barcode</TableHead>
              {cols.ap_code && <TableHead>AP code</TableHead>}
              <TableHead>Description</TableHead>
              {cols.country && <TableHead>Country</TableHead>}
              {cols.flavour && <TableHead>Flavour</TableHead>}
              {cols.size && <TableHead>Size</TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground">No materials</TableCell></TableRow>}
              {filtered.slice(0, 500).map((m) => (
                <TableRow key={m.id} className={cn(canManage && "cursor-pointer")} onClick={() => { if (canManage) { setForm(m); setEditOpen(true); } }}>
                  <TableCell><Badge variant="outline" className="text-[10px] capitalize">{m.material_type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{m.barcode ?? "—"}</TableCell>
                  {cols.ap_code && <TableCell className="font-mono text-xs">{m.ap_code ?? "—"}</TableCell>}
                  <TableCell className="max-w-[16rem] truncate">{m.description ?? "—"}</TableCell>
                  {cols.country && <TableCell>{m.country ?? "—"}</TableCell>}
                  {cols.flavour && <TableCell>{m.flavour ?? "—"}</TableCell>}
                  {cols.size && <TableCell>{m.size ?? "—"}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length > 500 && <p className="mt-2 text-xs text-muted-foreground">Showing first 500 of {filtered.length}. Use search/filter to narrow.</p>}
        </CardContent>
      </Card>

      {/* Edit / add material */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Edit material" : "New material"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label>
                <Select value={form.material_type ?? "tub"} onValueChange={(v) => setForm({ ...form, material_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COMPONENT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Pack type</Label>
                <Select value={form.pack_type ?? "__none__"} onValueChange={(v) => setForm({ ...form, pack_type: v === "__none__" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">—</SelectItem>{PACK_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Barcode</Label><Input value={form.barcode ?? ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
              <div><Label>AP code</Label><Input value={form.ap_code ?? ""} onChange={(e) => setForm({ ...form, ap_code: e.target.value })} /></div>
            </div>
            <div><Label>Description</Label><Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Country</Label><Input value={form.country ?? ""} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
              <div><Label>Flavour</Label><Input value={form.flavour ?? ""} onChange={(e) => setForm({ ...form, flavour: e.target.value })} /></div>
              <div><Label>Size</Label><Input value={form.size ?? ""} onChange={(e) => setForm({ ...form, size: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDialog kind="materials" open={importOpen} onOpenChange={setImportOpen} onDone={() => qc.invalidateQueries({ queryKey: ["pvs_materials"] })} />
      <ImportDialog kind="guide" open={guideOpen} onOpenChange={setGuideOpen} onDone={() => qc.invalidateQueries({ queryKey: ["pvs_materials"] })} />
    </div>
  );
}

// ============================================================
// Production orders
// ============================================================
function OrdersView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Partial<Order>>({});

  const { data: orders = [] } = useQuery({
    queryKey: ["pvs_orders"],
    queryFn: async () => {
      const { data, error } = await tbl("production_orders").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as Order[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.po_number?.trim()) throw new Error("Production order number is required");
      const payload = {
        po_number: form.po_number.trim(), sku: form.sku || null, country: form.country || null,
        packaging_type: form.packaging_type || null, qty: form.qty ?? null, line: form.line || null,
        planned_date: form.planned_date || null, status: form.status || "planned",
      };
      if (form.id) { const { error } = await tbl("production_orders").update(payload as never).eq("id", form.id); if (error) throw error; }
      else { const { error } = await tbl("production_orders").insert({ ...payload, created_by: user?.id ?? null } as never); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pvs_orders"] }); setEditOpen(false); toast.success("Order saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{orders.length} order{orders.length === 1 ? "" : "s"}. Each order carries the <b>packaging route</b> that drives verification.</p>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-1 h-4 w-4" />Import</Button>
            <Button onClick={() => { setForm({ status: "planned", packaging_type: "TUB" }); setEditOpen(true); }}><Plus className="mr-1 h-4 w-4" />New order</Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Production orders ({orders.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>PO #</TableHead><TableHead>SKU</TableHead><TableHead>Country</TableHead>
              <TableHead>Packaging</TableHead><TableHead>Qty</TableHead><TableHead>Line</TableHead><TableHead>Planned</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {orders.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No orders</TableCell></TableRow>}
              {orders.map((o) => (
                <TableRow key={o.id} className={cn(canManage && "cursor-pointer")} onClick={() => { if (canManage) { setForm(o); setEditOpen(true); } }}>
                  <TableCell className="font-mono text-xs">{o.po_number}</TableCell>
                  <TableCell className="font-mono text-xs">{o.sku ?? "—"}</TableCell>
                  <TableCell>{o.country ?? "—"}</TableCell>
                  <TableCell>{o.packaging_type ? <Badge variant="outline" className="text-[10px]">{o.packaging_type}</Badge> : "—"}</TableCell>
                  <TableCell>{o.qty ?? "—"}</TableCell>
                  <TableCell>{o.line ?? "—"}</TableCell>
                  <TableCell>{o.planned_date ?? "—"}</TableCell>
                  <TableCell className="text-xs capitalize text-muted-foreground">{o.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Edit order" : "New production order"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>PO #</Label><Input value={form.po_number ?? ""} onChange={(e) => setForm({ ...form, po_number: e.target.value })} /></div>
              <div><Label>SKU</Label><Input value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Country</Label><Input value={form.country ?? ""} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
              <div><Label>Packaging</Label>
                <Select value={form.packaging_type ?? "TUB"} onValueChange={(v) => setForm({ ...form, packaging_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PACK_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Qty</Label><Input type="number" value={form.qty ?? ""} onChange={(e) => setForm({ ...form, qty: e.target.value === "" ? null : Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Line</Label><Input value={form.line ?? ""} onChange={(e) => setForm({ ...form, line: e.target.value })} /></div>
              <div><Label>Planned</Label><Input type="date" value={form.planned_date ?? ""} onChange={(e) => setForm({ ...form, planned_date: e.target.value })} /></div>
              <div><Label>Status</Label>
                <Select value={form.status ?? "planned"} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["planned", "running", "verified", "done"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDialog kind="orders" open={importOpen} onOpenChange={setImportOpen} onDone={() => qc.invalidateQueries({ queryKey: ["pvs_orders"] })} />
    </div>
  );
}

// ============================================================
// Packaging BOM
// ============================================================
const COMPONENT_ORDER = ["label", "bag", "tub", "lid", "scoop", "box", "other"];
interface BomRow {
  id: string; sku: string; packaging_type: string; component: string; required_qty: number;
  materials: { barcode: string | null; ap_code: string | null; material_type: string; description: string | null } | null;
}

function BomView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [bagsOpen, setBagsOpen] = useState(false);

  const { data: bom = [] } = useQuery({
    queryKey: ["pvs_bom"],
    queryFn: async () => {
      const all: BomRow[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await tbl("packaging_bom")
          .select("id, sku, packaging_type, component, required_qty, materials(barcode, ap_code, material_type, description)")
          .order("sku", { ascending: true }).range(from, from + 999);
        if (error) throw error;
        const page = (data ?? []) as unknown as BomRow[];
        all.push(...page);
        if (page.length < 1000) break;
        from += 1000;
      }
      return all;
    },
  });

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const m = new Map<string, { sku: string; pack: string; rows: BomRow[] }>();
    for (const r of bom) {
      if (q && !r.sku.toLowerCase().includes(q)) continue;
      const k = `${r.sku}||${r.packaging_type}`;
      if (!m.has(k)) m.set(k, { sku: r.sku, pack: r.packaging_type, rows: [] });
      m.get(k)!.rows.push(r);
    }
    const arr = Array.from(m.values());
    for (const g of arr) g.rows.sort((a, b) => COMPONENT_ORDER.indexOf(a.component) - COMPONENT_ORDER.indexOf(b.component));
    return arr.sort((a, b) => a.sku.localeCompare(b.sku) || a.pack.localeCompare(b.pack));
  }, [bom, search]);

  const skuCount = useMemo(() => new Set(bom.map((r) => r.sku)).size, [bom]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {skuCount} SKU{skuCount === 1 ? "" : "s"} · {groups.length} routes.
          Import the <b>label list</b> (→ TUB) and <b>bag list</b> (→ BAG) to seed identities. Internal components (tub/lid/scoop/box) come from the product guide next.
        </p>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLabelsOpen(true)}><Upload className="mr-1 h-4 w-4" />Import label list</Button>
            <Button variant="outline" onClick={() => setBagsOpen(true)}><Upload className="mr-1 h-4 w-4" />Import bag list</Button>
          </div>
        )}
      </div>

      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU…" className="w-72" />

      {groups.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No BOM yet. Import your label and bag lists to start.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.slice(0, 300).map((g) => (
            <Card key={`${g.sku}|${g.pack}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-mono">{g.sku}</CardTitle>
                <Badge variant="outline" className="text-[10px]">{g.pack}</Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y text-sm">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="capitalize">{r.component}</span>
                      <span className="font-mono text-xs text-muted-foreground">{r.materials?.barcode ?? r.materials?.ap_code ?? "— não ligado —"}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {groups.length > 300 && <p className="text-xs text-muted-foreground">Showing first 300 routes. Use search to narrow.</p>}

      <ImportDialog kind="labels" open={labelsOpen} onOpenChange={setLabelsOpen} onDone={() => { qc.invalidateQueries({ queryKey: ["pvs_bom"] }); qc.invalidateQueries({ queryKey: ["pvs_materials"] }); }} />
      <ImportDialog kind="bags" open={bagsOpen} onOpenChange={setBagsOpen} onDone={() => { qc.invalidateQueries({ queryKey: ["pvs_bom"] }); qc.invalidateQueries({ queryKey: ["pvs_materials"] }); }} />
    </div>
  );
}

// ============================================================
// Generic Excel/CSV import
// ============================================================
type ImportKind = "materials" | "orders" | "labels" | "bags" | "guide";

interface FieldDef { key: string; label: string; required?: boolean; aliases: string[] }
const SKU_FIELDS: FieldDef[] = [
  { key: "product", label: "Product name", required: true, aliases: ["product", "product name", "name", "nome", "desc", "description", "descricao", "descrição"] },
  { key: "barcode", label: "Barcode", required: true, aliases: ["barcode", "ean", "gtin", "bar code", "código de barras", "codigo de barras"] },
  { key: "hb_sku", label: "HB SKU (optional)", aliases: ["hb sku", "hb_sku", "hbsku", "sku"] },
];
const FIELD_CONFIGS: Record<ImportKind, FieldDef[]> = {
  labels: SKU_FIELDS,
  bags: SKU_FIELDS,
  guide: [
    { key: "tub", label: "Tub / container", aliases: ["container", "tub", "pote", "recipiente"] },
    { key: "lid", label: "Lid", aliases: ["lid", "tampa"] },
    { key: "scoop", label: "Scoop", aliases: ["scoop", "colher", "medidor"] },
    { key: "box", label: "Box", aliases: ["type_of_box", "type of box", "box", "caixa"] },
  ],
  materials: [
    { key: "material_type", label: "Type", aliases: ["type", "material type", "material_type", "tipo"] },
    { key: "barcode", label: "Barcode", aliases: ["barcode", "ean", "gtin", "codigo de barras", "código de barras", "code"] },
    { key: "ap_code", label: "AP code", aliases: ["ap code", "ap_code", "ap", "codigo ap", "código ap"] },
    { key: "description", label: "Description", aliases: ["description", "descricao", "descrição", "name", "nome", "desc"] },
    { key: "country", label: "Country", aliases: ["country", "pais", "país"] },
    { key: "flavour", label: "Flavour", aliases: ["flavour", "flavor", "sabor"] },
    { key: "size", label: "Size", aliases: ["size", "tamanho", "weight", "peso"] },
    { key: "pack_type", label: "Pack type", aliases: ["pack type", "pack_type", "packaging", "packaging type", "embalagem"] },
  ],
  orders: [
    { key: "po_number", label: "PO number", required: true, aliases: ["production order", "po", "po number", "po_number", "order", "ordem", "wo", "#"] },
    { key: "sku", label: "SKU", aliases: ["sku", "code", "codigo", "código"] },
    { key: "country", label: "Country", aliases: ["country", "pais", "país"] },
    { key: "packaging_type", label: "Packaging type", aliases: ["packaging type", "packaging", "pack type", "tipo embalagem", "embalagem"] },
    { key: "qty", label: "Qty", aliases: ["qty", "quantity", "quantidade", "qtd"] },
    { key: "line", label: "Line", aliases: ["line", "linha"] },
    { key: "planned_date", label: "Date", aliases: ["date", "planned", "planned date", "data"] },
  ],
};
function guessMapping(headers: string[], fields: FieldDef[]): Record<string, string> {
  const lc = headers.map((h) => ({ h, lc: h.trim().toLowerCase() }));
  const m: Record<string, string> = {};
  for (const f of fields) m[f.key] = lc.find((x) => f.aliases.includes(x.lc))?.h ?? "";
  return m;
}
function pick(row: Record<string, unknown>, mapping: Record<string, string>, key: string): string {
  const col = mapping[key];
  return col ? String(row[col] ?? "").trim() : "";
}
function toIsoDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`; }
  return s.match(/^\d{4}-\d{2}-\d{2}/) ? s.slice(0, 10) : null;
}
function transformRow(row: Record<string, unknown>, mapping: Record<string, string>, kind: ImportKind): Record<string, unknown> | null {
  if (kind === "labels" || kind === "bags") {
    const product = pick(row, mapping, "product");
    const barcode = pick(row, mapping, "barcode");
    const sku = product || pick(row, mapping, "hb_sku"); // key = product name; fall back to HB SKU
    return sku && barcode ? { sku, barcode: barcode || null, description: product || null } : null;
  }
  if (kind === "guide") {
    const clean = (s: string) => { const v = s.trim(); return v && v.toLowerCase() !== "n/a" ? v : ""; };
    const tubRaw = clean(pick(row, mapping, "tub"));
    const tub = tubRaw && !/^bag\b/i.test(tubRaw) ? tubRaw : ""; // bags come from the bag list, not a shared component
    const lid = clean(pick(row, mapping, "lid"));
    const scoop = clean(pick(row, mapping, "scoop"));
    const box = clean(pick(row, mapping, "box"));
    return (tub || lid || scoop || box) ? { tub: tub || null, lid: lid || null, scoop: scoop || null, box: box || null } : null;
  }
  if (kind === "materials") {
    const r = {
      material_type: normType(pick(row, mapping, "material_type")),
      barcode: pick(row, mapping, "barcode") || null,
      ap_code: pick(row, mapping, "ap_code") || null,
      description: pick(row, mapping, "description") || null,
      country: pick(row, mapping, "country") || null,
      flavour: pick(row, mapping, "flavour") || null,
      size: pick(row, mapping, "size") || null,
      pack_type: normPack(pick(row, mapping, "pack_type")),
      active: true,
    };
    return r.barcode || r.ap_code ? r : null;
  }
  const q = Number(pick(row, mapping, "qty"));
  const r = {
    po_number: pick(row, mapping, "po_number"),
    sku: pick(row, mapping, "sku") || null,
    country: pick(row, mapping, "country") || null,
    packaging_type: normPack(pick(row, mapping, "packaging_type")),
    qty: isNaN(q) || q === 0 ? null : q,
    line: pick(row, mapping, "line") || null,
    planned_date: toIsoDate(pick(row, mapping, "planned_date")),
    status: "planned",
  };
  return r.po_number ? r : null;
}

function ImportDialog({ kind, open, onOpenChange, onDone }: { kind: ImportKind; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { user } = useAuth();
  const fields = FIELD_CONFIGS[kind];
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const reset = () => { setRawRows([]); setHeaders([]); setMapping({}); setFileName(""); };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const json = wb.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "", raw: false }) as Record<string, unknown>[]);
      if (json.length === 0) { toast.error("The file has no rows."); return; }
      const hdrs = Array.from(new Set(json.flatMap((r) => Object.keys(r))));
      setRawRows(json);
      setHeaders(hdrs);
      setMapping(guessMapping(hdrs, fields));   // auto-guess; user can adjust
      setFileName(file.name);
    } catch (e) { toast.error(`Could not read file: ${(e as Error)?.message ?? "unknown"}`); }
  };

  const rows = useMemo(
    () => rawRows.map((r) => transformRow(r, mapping, kind)).filter((r): r is Record<string, unknown> => r !== null),
    [rawRows, mapping, kind],
  );
  const requiredMapped = fields.filter((f) => f.required).every((f) => mapping[f.key]);
  const totalRead = rawRows.length;

  const importAll = async () => {
    setImporting(true);
    try {
      if (kind === "labels" || kind === "bags") {
        const type = kind === "labels" ? "label" : "bag";
        const pack = kind === "labels" ? "TUB" : "BAG";
        const valid = rows.filter((r) => r.sku && r.barcode) as { sku: string; barcode: string; description: string | null }[];
        // 1) upsert materials (dedupe by barcode), collect barcode -> id
        const seenBc = new Set<string>();
        const mats = valid.filter((r) => !seenBc.has(r.barcode) && seenBc.add(r.barcode))
          .map((r) => ({ material_type: type, barcode: r.barcode, description: r.description, active: true, created_by: user?.id ?? null }));
        const barcodeToId = new Map<string, string>();
        for (let i = 0; i < mats.length; i += 200) {
          const { data, error } = await tbl("materials").upsert(mats.slice(i, i + 200) as never, { onConflict: "barcode" }).select("id, barcode");
          if (error) throw error;
          for (const m of (data ?? []) as unknown as { id: string; barcode: string }[]) barcodeToId.set(m.barcode, m.id);
        }
        // 2) upsert BOM identity rows (dedupe by sku)
        const seenSku = new Set<string>();
        const bom = valid.filter((r) => !seenSku.has(r.sku) && seenSku.add(r.sku))
          .map((r) => ({ sku: r.sku, packaging_type: pack, component: type, material_id: barcodeToId.get(r.barcode) ?? null, required_qty: 1, sequence: 1, created_by: user?.id ?? null }));
        for (let i = 0; i < bom.length; i += 200) {
          const { error } = await tbl("packaging_bom").upsert(bom.slice(i, i + 200) as never, { onConflict: "sku,packaging_type,component" });
          if (error) throw error;
        }
        toast.success(`Imported ${bom.length} SKU${bom.length === 1 ? "" : "s"} (${type} → ${pack})`);
        onDone(); onOpenChange(false); reset();
        return;
      }
      if (kind === "guide") {
        // Extract the distinct physical components (tub/lid/scoop/box) from the guide → Materials catalog.
        const comps = new Map<string, { material_type: string; description: string }>();
        const add = (type: string, desc: unknown) => {
          const d = String(desc ?? "").trim();
          if (!d) return;
          const k = `${type}|${d.toLowerCase()}`;
          if (!comps.has(k)) comps.set(k, { material_type: type, description: d });
        };
        for (const r of rows) { add("tub", r.tub); add("lid", r.lid); add("scoop", r.scoop); add("box", r.box); }
        const distinct = [...comps.values()];
        // Skip components already catalogued (dedupe by type + description).
        const existing = new Set<string>();
        for (const t of ["tub", "lid", "scoop", "box"]) {
          const { data, error } = await tbl("materials").select("material_type, description").eq("material_type", t);
          if (error) throw error;
          for (const m of (data ?? []) as { material_type: string; description: string | null }[])
            if (m.description) existing.add(`${m.material_type}|${m.description.toLowerCase()}`);
        }
        const fresh = distinct
          .filter((c) => !existing.has(`${c.material_type}|${c.description.toLowerCase()}`))
          .map((c) => ({ ...c, active: true, created_by: user?.id ?? null }));
        for (let i = 0; i < fresh.length; i += 200) {
          const { error } = await tbl("materials").insert(fresh.slice(i, i + 200) as never);
          if (error) throw error;
        }
        toast.success(`Imported ${fresh.length} new component${fresh.length === 1 ? "" : "s"} (${distinct.length} distinct, ${distinct.length - fresh.length} already existed)`);
        onDone(); onOpenChange(false); reset();
        return;
      }
      if (kind === "materials") {
        const withBarcode = rows.filter((r) => r.barcode).map((r) => ({ ...r, created_by: user?.id ?? null }));
        const apOnly = rows.filter((r) => !r.barcode && r.ap_code).map((r) => ({ ...r, created_by: user?.id ?? null }));
        for (let i = 0; i < withBarcode.length; i += 200) {
          const { error } = await tbl("materials").upsert(withBarcode.slice(i, i + 200) as never, { onConflict: "barcode", ignoreDuplicates: true });
          if (error) throw error;
        }
        for (let i = 0; i < apOnly.length; i += 200) {
          const { error } = await tbl("materials").upsert(apOnly.slice(i, i + 200) as never, { onConflict: "ap_code", ignoreDuplicates: true });
          if (error) throw error;
        }
      } else {
        const payload = rows.map((r) => ({ ...r, created_by: user?.id ?? null }));
        for (let i = 0; i < payload.length; i += 200) {
          const { error } = await tbl("production_orders").upsert(payload.slice(i, i + 200) as never, { onConflict: "po_number" });
          if (error) throw error;
        }
      }
      toast.success(`Imported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
      onDone(); onOpenChange(false); reset();
    } catch (e) { toast.error(`Import failed: ${(e as Error)?.message ?? "unknown"}`); }
    finally { setImporting(false); }
  };

  const downloadTemplate = () => {
    const cfg: Record<ImportKind, { headers: string[]; sample: string[]; sheet: string }> = {
      materials: { headers: ["Type", "Barcode", "AP Code", "Description", "Country", "Flavour", "Size", "Pack Type"], sample: ["tub", "", "AP009211", "Tub 900g black", "UK", "", "900g", "TUB"], sheet: "Materials" },
      orders: { headers: ["Production Order", "SKU", "Country", "Packaging Type", "Qty", "Line", "Date"], sample: ["PO-48213", "MM900-UK-CC", "UK", "TUB", "500", "Line 4", "23/07/2026"], sheet: "Orders" },
      labels: { headers: ["Product", "Barcode", "HB SKU"], sample: ["Whey Cookies 900g UK", "56056555203347", "MM900-UK-CC"], sheet: "Labels" },
      bags: { headers: ["Product", "Barcode", "HB SKU"], sample: ["Whey Cookies 900g UK", "56056555209901", "MM900-UK-CC"], sheet: "Bags" },
      guide: { headers: ["Product", "Weight", "Container", "Lid", "Scoop", "Type_of_box"], sample: ["ABE", "250g", "750ml AN - Black", "100mm - Black AN", "20ml blue", "Box ABE 6"], sheet: "Guide" },
    };
    const { headers, sample, sheet } = cfg[kind];
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    ws["!cols"] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, `${kind}-template.xlsx`);
  };

  const kindLabel = kind === "materials" ? "materials" : kind === "orders" ? "production orders" : kind === "labels" ? "label list (→ TUB)" : kind === "bags" ? "bag list (→ BAG)" : "product guide (→ components)";

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><PackageSearch className="h-5 w-5" />Import {kindLabel} from Excel/CSV</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}><FileDown className="mr-1 h-4 w-4" />Template</Button>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" /> Choose file
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </label>
            {fileName && <span className="text-sm text-muted-foreground">{fileName} — {totalRead} rows</span>}
          </div>

          {/* Column mapping — link each file column to a system field */}
          {headers.length > 0 && (
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Map your columns</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-sm">{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
                    <Select value={mapping[f.key] || "__none__"} onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === "__none__" ? "" : v }))}>
                      <SelectTrigger className={cn("h-8 flex-1", f.required && !mapping[f.key] && "border-destructive")}><SelectValue placeholder="— column —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— none —</SelectItem>
                        {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Auto-matched by name — adjust any that are wrong. <span className="font-medium text-foreground">{rows.length}</span> of {totalRead} rows are valid
                {totalRead > rows.length ? ` · ${totalRead - rows.length} skipped (missing required field)` : ""}.
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>{Object.keys(rows[0]).filter((k) => k !== "created_by").map((k) => <th key={k} className="px-2 py-1 text-left font-medium">{k}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-t">{Object.keys(rows[0]).filter((k) => k !== "created_by").map((k) => <td key={k} className="px-2 py-1">{String(r[k] ?? "")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && <p className="px-2 py-1 text-[11px] text-muted-foreground">+ {rows.length - 8} more…</p>}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {kind === "materials" ? "Duplicates (same barcode or AP code) are skipped."
              : kind === "orders" ? "Existing PO numbers are updated."
              : kind === "guide" ? "Extracts the distinct tubs, lids, scoops and boxes into the Materials catalog. Components already catalogued are skipped. Bags & labels aren't taken from here."
              : `Each row = one SKU. Creates the ${kind === "labels" ? "label" : "bag"} material and its ${kind === "labels" ? "TUB" : "BAG"} BOM identity row. Re-import updates. Raw materials aren't relevant here.`}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={importAll} disabled={rows.length === 0 || !requiredMapped || importing}>{importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Import {rows.length || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
