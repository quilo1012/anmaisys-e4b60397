import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, Upload, Search, Download } from "lucide-react";
import { toast } from "sonner";

interface Sku { id: string; code: string; name: string; category: string | null; target_per_hour: number | null; active: boolean }

type SkuImportRow = {
  code: string;
  name: string;
  category: string | null;
  target_per_hour: number;
  active: boolean;
};

const PAGE_SIZE = 50;

function parseCSV(text: string): Partial<Sku>[] {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .filter((l, index) => index !== 0 || !/^sep\s*=\s*[;,\t]/i.test(l.trim()));
  if (lines.length === 0) return [];
  // Auto-detect delimiter from the first rows: ; \t , (whichever appears most)
  const sample = lines.slice(0, 20).join("\n");
  const counts = { ";": (sample.match(/;/g) || []).length, "\t": (sample.match(/\t/g) || []).length, ",": (sample.match(/,/g) || []).length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as string;
  const parseLine = (l: string): string[] => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === delim && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur); return out.map((s) => s.trim().replace(/^"|"$/g, ""));
  };
  const normalize = (value: string) => value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const headers = parseLine(lines[0]).map(normalize);
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const iCode = idx(["sku", "code", "codigo", "cod", "item", "product_code", "product code", "productcode"]);
  const iName = idx(["name", "produto", "product", "nome", "descricao", "description", "designacao", "product_description", "product description", "productdescription"]);
  const iCat = idx(["category", "categoria"]);
  const iTph = idx(["target_per_hour", "target", "tph", "target per hour", "objetivo"]);
  const hasHeader = iCode >= 0 || iName >= 0;
  const byCode = new Map<string, Partial<Sku>>();
  const start = hasHeader ? 1 : 0;

  for (let r = start; r < lines.length; r++) {
    const cols = parseLine(lines[r]);
    let code = hasHeader && iCode >= 0 ? cols[iCode] : cols[0];
    let name = hasHeader && iName >= 0 ? cols[iName] : cols[1];

    // ANPlaner exports can contain duplicate code columns: SKU;SKU;Description.
    if (code && name && normalize(code) === normalize(name) && cols[2]) name = cols[2];

    code = (code ?? "").trim();
    name = (name ?? "").trim();
    if (!code) continue;

    const targetValue = iTph >= 0 && cols[iTph] ? Number(String(cols[iTph]).replace(",", ".")) : null;
    const row: Partial<Sku> = {
      code,
      name,
      category: iCat >= 0 ? cols[iCat] || null : null,
      target_per_hour: Number.isFinite(targetValue) ? targetValue : 0,
      active: true,
    };

    const key = normalize(code);
    const previous = byCode.get(key);
    if (!previous || (!previous.name && row.name)) byCode.set(key, row);
  }
  return Array.from(byCode.values()).filter((row) => row.code && row.name);
}

export default function SKUProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Partial<Sku> | null>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["sku_products_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_products").select("*").order("code");
      if (error) throw error;
      return (data ?? []) as Sku[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return all.filter((p) => !s || p.code.toLowerCase().includes(s) || p.name.toLowerCase().includes(s));
  }, [all, search]);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const save = useMutation({
    mutationFn: async (sku: Partial<Sku>) => {
      const payload = {
        code: sku.code ?? "", name: sku.name ?? "", category: sku.category ?? null,
        target_per_hour: sku.target_per_hour ?? null, active: sku.active ?? true,
      };
      if (!payload.code || !payload.name) throw new Error("Code and Name required");
      if (sku.id) {
        const { error } = await supabase.from("sku_products").update(payload).eq("id", sku.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sku_products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sku_products_all"] }); setOpen(false); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sku_products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sku_products_all"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) { toast.error("No valid rows. Use CSV with SKU and Name/Description columns."); return; }
      const BATCH = 500;
      let ok = 0;
      const valid = rows
        .filter((r): r is SkuImportRow => !!r.code && !!r.name)
        .map((r) => ({ ...r, target_per_hour: r.target_per_hour ?? 0 }));
      if (!valid.length) { toast.error("No rows with SKU and Name found"); return; }
      const importSkuProducts = supabase.rpc.bind(supabase) as unknown as (
        fn: "import_sku_products",
        args: { _rows: SkuImportRow[] },
      ) => Promise<{ data: { count?: number } | null; error: { message: string } | null }>;
      for (let i = 0; i < valid.length; i += BATCH) {
        const slice = valid.slice(i, i + BATCH);
        const { data, error } = await importSkuProducts("import_sku_products", { _rows: slice });
        if (error) throw error;
        ok += data?.count ?? slice.length;
      }
      qc.invalidateQueries({ queryKey: ["sku_products_all"] });
      toast.success(`Imported ${ok} SKUs from ${valid.length} valid rows`);
    } catch (e) {
      const message = (e as Error).message || "CSV import failed";
      toast.error(message.includes("Forbidden") ? "Only Admin or Manager can import SKUs" : message);
    } finally { setImporting(false); }
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">SKU Products</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Upload CSV File — required columns: <code>product_code</code> (or SKU) and <code>product_description</code> (or name).
              Accepts various header formats (SKU, Codigo, Code, Name, Description, etc.).
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const csv = "SKU;SKU;Descrição\nBFHYDRATDS;BFHYDRATDS;BODYFUEL HYDRATION DRINK\nBFENERGYDS;BFENERGYDS;BODYFUEL ENERGY DRINK\n";
                const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "sku_products_template.csv";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <Download className="h-4 w-4 mr-1" />Template CSV
            </Button>
            <label>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await handleImport(file);
                  e.currentTarget.value = "";
                }}
              />
              <Button variant="outline" disabled={importing} asChild><span><Upload className="h-4 w-4 mr-1" />{importing ? "Importing..." : "Import CSV"}</span></Button>
            </label>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditing({ active: true })}><Plus className="h-4 w-4 mr-1" />New SKU</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing?.id ? "Edit SKU" : "New SKU"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Code</Label><Input value={editing?.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
                  <div><Label>Name</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                  <div><Label>Category</Label><Input value={editing?.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></div>
                  <div><Label>Target / hour</Label><Input type="number" value={editing?.target_per_hour ?? ""} onChange={(e) => setEditing({ ...editing, target_per_hour: e.target.value ? +e.target.value : null })} /></div>
                </div>
                <DialogFooter><Button onClick={() => editing && save.mutate(editing)} disabled={save.isPending || !editing?.code || !editing?.name}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by code or name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
              <Badge variant="outline">{filtered.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>TPH</TableHead><TableHead>Active</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>}
                {!isLoading && pageRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No SKUs</TableCell></TableRow>}
                {pageRows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.category ?? "—"}</TableCell>
                    <TableCell>{p.target_per_hour ?? "—"}</TableCell>
                    <TableCell>{p.active ? <Badge>Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => confirm("Delete SKU?") && del.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pages > 1 && (
              <div className="flex items-center justify-between mt-3">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
                <span className="text-sm text-muted-foreground">Page {page + 1} / {pages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
