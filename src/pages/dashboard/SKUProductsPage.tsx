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
import { Plus, Trash2, Pencil, Upload, Search, Download, Eraser, Undo2 } from "lucide-react";
import { toast } from "sonner";
import ExcelJS from "exceljs";

interface Sku { id: string; code: string; name: string; category: string | null; target_per_hour: number | null; weight: number | null; active: boolean }

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
    .replace(/[^a-z0-9]/g, "")
    .trim();
  const CODE_KEYS = ["sku", "code", "codigo", "cod", "item", "productcode", "itemcode", "artigo", "ref", "referencia", "uipartnumber", "partnumber", "partno"];
  const NAME_KEYS = ["name", "produto", "product", "nome", "descricao", "description", "designacao", "productdescription", "itemname", "itemdescription"];
  // Find header row within the first 15 lines (skips title/banner rows).
  let headerRow = 0;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const h = parseLine(lines[i]).map(normalize);
    if (h.some((c) => CODE_KEYS.includes(c)) || h.some((c) => NAME_KEYS.includes(c))) {
      headerRow = i; headers = h; break;
    }
  }
  if (!headers.length) headers = parseLine(lines[0]).map(normalize);
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const iCode = idx(CODE_KEYS);
  const iName = idx(NAME_KEYS);
  const iCat = idx(["category", "categoria", "familia", "family", "machine", "maquina"]);
  const iTph = idx(["targetperhour", "target", "tph", "objetivo"]);
  const iWeight = idx(["weight", "peso", "partweight"]);
  const iCycle = idx(["standardcycletime", "cycletime", "cycle", "tempociclo"]);
  const iCav = idx(["cavities", "cavidades", "cav"]);
  const hasHeader = iCode >= 0 || iName >= 0;
  const byCode = new Map<string, Partial<Sku>>();
  const start = hasHeader ? headerRow + 1 : 0;


  for (let r = start; r < lines.length; r++) {
    const cols = parseLine(lines[r]);
    let code = hasHeader && iCode >= 0 ? cols[iCode] : cols[0];
    let name = hasHeader && iName >= 0 ? cols[iName] : cols[1];

    // ANPlaner exports can contain duplicate code columns: SKU;SKU;Description.
    if (code && name && normalize(code) === normalize(name) && cols[2]) name = cols[2];

    code = (code ?? "").trim();
    name = (name ?? "").trim();
    if (!code) continue;

    const num = (i: number) => (i >= 0 && cols[i] ? Number(String(cols[i]).replace(",", ".")) : NaN);
    const targetDirect = num(iTph);
    const cycle = num(iCycle); // seconds per cycle
    const cav = num(iCav);
    let tph: number = Number.isFinite(targetDirect) ? targetDirect : 0;
    if (!tph && Number.isFinite(cycle) && cycle > 0) {
      const cavities = Number.isFinite(cav) && cav > 0 ? cav : 1;
      tph = Math.round((3600 / cycle) * cavities);
    }
    const weight = num(iWeight);
    const row: Partial<Sku> = {
      code,
      name,
      category: iCat >= 0 ? cols[iCat] || null : null,
      target_per_hour: tph,
      weight: Number.isFinite(weight) ? weight : null,
      active: true,
    };

    const key = normalize(code);
    const previous = byCode.get(key);
    if (!previous || (!previous.name && row.name)) byCode.set(key, row);
  }
  return Array.from(byCode.values()).filter((row) => row.code && row.name);
}


function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (typeof v === "object") {
    const obj = v as { text?: string; result?: unknown; richText?: Array<{ text: string }>; hyperlink?: string };
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text ?? "").join("").trim();
    if (typeof obj.text === "string") return obj.text.trim();
    if (obj.result != null) return cellText(obj.result);
  }
  return String(v).trim();
}

async function parseXLSX(file: File): Promise<Partial<Sku>[]> {
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { arr[col - 1] = cellText(cell.value); });
    if (arr.some((c) => c && c.length)) rows.push(arr.map((c) => c ?? ""));
  });
  if (!rows.length) return [];
  // Reuse the CSV parser by serialising back as a tab-delimited string.
  const tsv = rows.map((r) => r.map((c) => c.replace(/\t/g, " ")).join("\t")).join("\n");
  return parseCSV(tsv);
}

export default function SKUProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Partial<Sku> | null>(null);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const cleanupBatchSkus = async () => {
    if (!confirm("Remove all batch SKUs (e.g. 'CRE1KG - B9') and keep only the base (CRE1KG)?\n\nTheir production is moved to the base SKU with the batch kept in the Batch field. This cannot be undone (a backup exists).")) return;
    setCleaning(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rpc not in generated types
      const { data, error } = await (supabase as any).rpc("cleanup_batch_skus");
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;
      toast.success(`Done — ${r?.deleted ?? 0} batch SKUs removed, ${r?.repointed ?? 0} entries moved to base.`);
      qc.invalidateQueries({ queryKey: ["sku_products_all"] });
    } catch (e) {
      toast.error(`Failed: ${(e as Error)?.message ?? "unknown error"}`);
    } finally {
      setCleaning(false);
    }
  };

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["sku_products_all"],
    queryFn: async () => {
      // Paginate: PostgREST caps each response at ~1000 rows, so fetch pages
      // until a short page is returned — otherwise SKUs beyond 1000 are hidden
      // (search finds nothing / list looks empty for later codes).
      const pageSize = 1000;
      const rows: Sku[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.from("sku_products").select("*").order("code").range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as Sku[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
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
        target_per_hour: sku.target_per_hour ?? 0, weight: sku.weight ?? null, active: sku.active ?? true,
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
    if (!confirm("Import will ADD new SKUs and UPDATE matching ones from the file. Existing SKUs are kept — nothing is deleted. Continue?")) return;
    setImporting(true);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const rows = isXlsx ? await parseXLSX(file) : parseCSV(await file.text());
      if (!rows.length) { toast.error("No valid rows. Use a file with SKU and Name/Description columns."); return; }
      const valid = rows
        .filter((r): r is SkuImportRow => !!r.code && !!r.name)
        .map((r) => ({ ...r, target_per_hour: r.target_per_hour ?? 0 }));
      if (!valid.length) { toast.error("No rows with SKU and Name found"); return; }

      // Snapshot the current catalog first so this import can be undone
      // ("Restore previous import"). Non-fatal if it can't snapshot.
      try { await (supabase.rpc as any)("snapshot_sku_products"); } catch { /* ignore */ }

      // Merge by code (upsert) — never deletes existing SKUs.
      const BATCH = 500;
      let ok = 0;
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
      toast.success(`Imported ${ok} from ${valid.length} rows — existing SKUs kept. Use "Restore previous import" to undo.`);
    } catch (e) {
      const message = (e as Error).message || "Import failed";
      toast.error(message.includes("Forbidden") ? "Only Admin or Manager can import SKUs" : message);
    } finally { setImporting(false); }
  };

  const restorePrevious = async () => {
    if (!confirm("Restore the SKU catalog to the state BEFORE the last import? This replaces the current SKUs with the previous snapshot.")) return;
    setImporting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("restore_sku_products_from_backup");
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["sku_products_all"] });
      toast.success(`Restored ${(data as any)?.count ?? ""} SKUs from before the last import`);
    } catch (e) {
      const message = (e as Error).message || "Restore failed";
      toast.error(message.includes("No previous import") ? "No previous import to restore yet" : message);
    } finally { setImporting(false); }
  };

  const downloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("SKUs");
    // Columns match the importer: SKU + Description required; Category, TargetPerHour, Weight optional.
    ws.addRow(["SKU", "Description", "Category", "TargetPerHour", "Weight"]);
    ws.addRow(["END500BRBC", "ENDURANCE BREATHE ENERGY & ELECTROLYTE POWDER 500G - BLACKCURRANT", "VELOCITY AND ENDURANCE", "", 500]);
    ws.addRow(["END500BROB", "ENDURANCE BREATHE ENERGY & ELECTROLYTE POWDER 500G - ORANGE BURST", "VELOCITY AND ENDURANCE", "", 500]);
    ws.getRow(1).font = { bold: true };
    ws.columns = [{ width: 18 }, { width: 60 }, { width: 24 }, { width: 16 }, { width: 12 }];
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sku_products_template.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">SKU Products</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Upload Excel (.xlsx) — required columns: <code>SKU</code> (or product_code) and <code>Description</code> (or name).
              Optional: <code>Category</code>, <code>TargetPerHour</code>, <code>Weight</code>. Legacy <code>.csv</code> is still accepted.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={cleanupBatchSkus} disabled={cleaning}>
              <Eraser className="h-4 w-4 mr-1" />{cleaning ? "Cleaning..." : "Remove batch SKUs"}
            </Button>
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" />Template XLSX
            </Button>
            <label>
              <input
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await handleImport(file);
                  e.currentTarget.value = "";
                }}
              />
              <Button variant="outline" disabled={importing} asChild><span><Upload className="h-4 w-4 mr-1" />{importing ? "Importing..." : "Import XLSX"}</span></Button>
            </label>
            <Button variant="outline" onClick={restorePrevious} disabled={importing} title="Undo the last import — restore the SKUs to how they were before it">
              <Undo2 className="h-4 w-4 mr-1" />Restore previous import
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditing({ active: true })}><Plus className="h-4 w-4 mr-1" />New SKU</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing?.id ? "Edit SKU" : "New SKU"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>SKU</Label><Input value={editing?.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
                  <div><Label>Product</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                  <div><Label>Weight</Label><Input type="number" step="0.001" value={editing?.weight ?? ""} onChange={(e) => setEditing({ ...editing, weight: e.target.value ? +e.target.value : null })} /></div>
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
              <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Weight</TableHead><TableHead>Active</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={5} className="text-center">Loading...</TableCell></TableRow>}
                {!isLoading && pageRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No SKUs</TableCell></TableRow>}
                {pageRows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.weight ?? "—"}</TableCell>
                    <TableCell>{p.active ? <Badge className="bg-green-600 hover:bg-green-600 text-white border-transparent">Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
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
