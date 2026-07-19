import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Upload, FileSpreadsheet, AlertTriangle, Loader2, Cloud, Wand2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseIntouchCsvRows, parseIntouchWorkToList, type WorkToListSection } from "@/lib/intouchWorkToList";
import { useLines, useSkuProducts, useUpsertSession, useSaveItems } from "@/hooks/useProductionPlanner";
import { rescaleItemTargets } from "@/lib/ragTargetSplit";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate?: string;
  defaultShift?: "DAY" | "NIGHT";
  onImported?: () => void;
}

function useLineLeaders(shift: string) {
  return useQuery({
    queryKey: ["line_leaders", shift],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_leaders")
        .select("id, name, shift")
        .eq("active", true)
        .in("shift", [shift, "BOTH"])
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; shift: string }[];
    },
  });
}

function useAddLineLeader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; shift: string }) => {
      const { data, error } = await supabase
        .from("line_leaders")
        .insert({ name: input.name.trim(), shift: input.shift })
        .select("id, name, shift")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["line_leaders"] }),
  });
}

async function readFileAsCsv(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return await file.text();
  }
  const buf = await file.arrayBuffer();
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const lines: string[] = [];
  const esc = (v: unknown) => {
    let s = "";
    if (v == null) s = "";
    else if (typeof v === "object") {
      const anyV = v as { text?: string; result?: unknown; richText?: { text: string }[] };
      if (Array.isArray(anyV.richText)) s = anyV.richText.map((r) => r.text).join("");
      else if (anyV.text != null) s = String(anyV.text);
      else if (anyV.result != null) s = String(anyV.result);
      else s = String(v);
    } else s = String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  wb.eachSheet((sheet) => {
    let hasAny = false;
    const buffer: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const max = row.cellCount || 0;
      for (let c = 1; c <= max; c++) {
        cells.push(esc(row.getCell(c).value));
      }
      if (cells.some((c) => c !== '""')) {
        buffer.push(cells.join(","));
        hasAny = true;
      }
    });
    if (!hasAny) return;
    lines.push(`"Machine:","${sheet.name.replace(/"/g, '""')}"`);
    lines.push(...buffer);
  });
  return lines.join("\n");
}

function normalizeLine(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Jaccard char-bigram similarity (0..1) for fuzzy line ↔ machine matching.
function similarity(a: string, b: string) {
  const grams = (s: string) => {
    const t = normalizeLine(s);
    const g = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Aliases — same rules used in iTouching Settings auto-map.
const MAP_ALIASES: { intouch: RegExp; dbPatterns: RegExp[] }[] = [
  { intouch: /filler.*1|^line\s*1/i, dbPatterns: [/^line\s*1$/i] },
  { intouch: /filler.*2|^line\s*2/i, dbPatterns: [/^line\s*2$/i] },
  { intouch: /filler.*3|^line\s*3/i, dbPatterns: [/^line\s*3$/i] },
  { intouch: /filler.*4|^line\s*4/i, dbPatterns: [/^line\s*4$/i] },
  { intouch: /filler.*5|^line\s*5/i, dbPatterns: [/^line\s*5$/i, /^line\s*5a$/i, /^line\s*5b$/i] },
  { intouch: /filler.*6|^line\s*6/i, dbPatterns: [/^line\s*6$/i, /^line\s*6a$/i, /^line\s*6b$/i] },
  { intouch: /filler.*7|^line\s*7/i, dbPatterns: [/^line\s*7$/i] },
  { intouch: /capsul|tablet/i,       dbPatterns: [/capsul|tablet/i] },
  { intouch: /gel/i,                 dbPatterns: [/gel/i] },
];


function getImportErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    return [e.message, e.details, e.hint, e.code ? `Code: ${e.code}` : ""].filter(Boolean).join(" · ") || "Import failed";
  }
  return "Import failed";
}

export function IntouchImportDialog({ open, onOpenChange, defaultDate, defaultShift = "DAY", onImported }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [autoMapBusy, setAutoMapBusy] = useState(false);
  const [autoMapSaving, setAutoMapSaving] = useState(false);
  const [autoMapPreview, setAutoMapPreview] = useState<
    | null
    | Array<{ guid: string; intouch_name: string; line_id: string | null; line_name: string; reason: string; include: boolean }>
  >(null);

  const [date, setDate] = useState(defaultDate ?? format(new Date(), "yyyy-MM-dd"));
  const [shift, setShift] = useState<"DAY" | "NIGHT">(defaultShift);
  const [sections, setSections] = useState<WorkToListSection[]>([]);
  const [leaderByLine, setLeaderByLine] = useState<Record<string, { id?: string; name: string }>>({});
  const [includedLines, setIncludedLines] = useState<Record<string, boolean>>({});
  const [manualLineByLine, setManualLineByLine] = useState<Record<string, string>>({});
  const [parsePreview, setParsePreview] = useState<string[][]>([]);

  const { data: lines = [] } = useLines();
  const { data: skus = [] } = useSkuProducts();
  const { data: leaders = [] } = useLineLeaders(shift);
  const addLeader = useAddLineLeader();
  const upsertSession = useUpsertSession();
  const saveItems = useSaveItems();

  const skuByCode = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const s of skus) m.set(s.code.toUpperCase(), { id: s.id, name: s.name });
    return m;
  }, [skus]);

  const lineByNorm = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) m.set(normalizeLine(l.name), l.name);
    return m;
  }, [lines]);

  const matchLine = (sectionLine: string): string | undefined => {
    const norm = normalizeLine(sectionLine);
    const exact = lineByNorm.get(norm);
    if (exact) return exact;
    // Try ANY digit in the section name → "Line N" first (handles "Filler 2",
    // "L2", "Line 2 - Filler", "Filler Line 2", numeric ids, etc.)
    const nums = sectionLine.match(/\d+/g) ?? [];
    for (const n of nums) {
      const hit = lineByNorm.get(`line${n}`);
      if (hit) return hit;
    }
    // Substring fuzzy match (e.g. "gelline" ↔ "gel")
    for (const [k, v] of lineByNorm) {
      if (k.length >= 3 && (norm.includes(k) || k.includes(norm))) return v;
    }
    // Last resort: any line whose name shares the trailing number
    const num = nums[nums.length - 1];
    if (num) {
      const byNum = lines.find((l) => new RegExp(`(^|\\D)${num}(\\D|$)`).test(l.name));
      if (byNum) return byNum.name;
    }
    return undefined;
  };

  const resolved = useMemo(() => sections.map((sec) => {
    const matched = matchLine(sec.line);
    const items = sec.items.map((it) => {
      const sku = skuByCode.get(it.sku_code.toUpperCase());
      return { ...it, sku_id: sku?.id, sku_name: sku?.name };
    });
    const unknown = items.filter((i) => !i.sku_id).length;
    return { ...sec, matched_line: matched, items, unknown };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sections, lineByNorm, skuByCode, lines]);

  const activeSections = useMemo(() => resolved.filter((s) => includedLines[s.line] !== false), [resolved, includedLines]);
  const totalProducts = activeSections.reduce((a, s) => a + s.items.length, 0);
  const totalLines = activeSections.length;
  const canImport = totalProducts > 0
    && activeSections.every((s) => s.matched_line);

  const reset = () => {
    setSections([]);
    setLeaderByLine({});
    setIncludedLines({});
    setParsePreview([]);
  };

  // Override per-SKU qty using rag_weekly_entries.plan_qty (source of truth).
  // The API/XLSX qty is ignored — we rescale items so they sum to the RAG plan.
  const applyRagPlans = async (secs: WorkToListSection[]): Promise<WorkToListSection[]> => {
    const matched = secs.map((s) => ({ sec: s, line: matchLine(s.line) }));
    const lineNames = Array.from(new Set(matched.map((m) => m.line).filter(Boolean) as string[]));
    if (lineNames.length === 0) return secs;
    const { data, error } = await supabase
      .from("rag_weekly_entries")
      .select("line, plan_qty")
      .eq("entry_date", date)
      .eq("shift", shift)
      .in("line", lineNames);
    if (error) {
      console.warn("[applyRagPlans] failed to load RAG plan_qty:", error.message);
      return secs;
    }
    const planByLine = new Map<string, number>();
    for (const r of data ?? []) planByLine.set((r as { line: string }).line, Number((r as { plan_qty: number }).plan_qty) || 0);
    return matched.map(({ sec, line }) => {
      const plan = line ? planByLine.get(line) : undefined;
      if (!plan || plan <= 0 || sec.items.length === 0) return sec;
      const newQtys = rescaleItemTargets(sec.items.map((i) => ({ target: i.qty, planned: i.qty })), plan);
      return { ...sec, items: sec.items.map((it, i) => ({ ...it, qty: newQtys[i] ?? 0 })) };
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setLoading(true);
    try {
      const text = await readFileAsCsv(f);
      const previewRows = parseIntouchCsvRows(text).slice(0, 12).map((row) => row.slice(0, 8));
      setParsePreview(previewRows);
      console.log("[iTouching] first rows", previewRows);
      const parsed = parseIntouchWorkToList(text);
      console.log("[iTouching] sections detected:", parsed.map((s) => ({ line: s.line, skus: s.items.length, qty: s.items.reduce((a, i) => a + i.qty, 0) })));
      if (parsed.length === 0) {
        toast.error("No valid iTouching products found. Check the preview below and confirm the file has SKU/code and quantity columns.");
        return;
      }
      const withPlan = await applyRagPlans(parsed);
      setSections(withPlan);
      // pre-fill leader from active list (first available leader for shift)
      const init: Record<string, { id?: string; name: string }> = {};
      const inc: Record<string, boolean> = {};
      for (const s of withPlan) { init[s.line] = { name: "" }; inc[s.line] = true; }
      setLeaderByLine(init);
      setIncludedLines(inc);
      toast.success(`Detected ${parsed.length} line${parsed.length > 1 ? "s" : ""}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read file";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };
  const pullFromIntouch = async () => {
    setPulling(true);
    try {
      const { data, error } = await supabase.functions.invoke("intouch-list-scheduled-jobs", {
        body: { session_date: date, shift },
      });
      if (error) throw error;
      const secs = ((data as any)?.sections ?? []) as WorkToListSection[];
      if (secs.length === 0) {
        const root = (data as any) ?? {};
        const d = root.debug ?? root;
        const endpoints = (d?.endpoints ?? []) as Array<{ path: string; ok: boolean; bytes: number; sample?: unknown }>;
        const okHits = endpoints.filter((e) => e.ok && e.bytes > 2);
        console.log("[pullFromIntouch] debug:", {
          endpoints,
          mapped_machines: d?.mapped_machines ?? 0,
          machine_keys_seen: d?.machine_keys_seen ?? [],
        });
        const seen = (d?.machine_keys_seen ?? []) as string[];
        const mapped = (d?.mapped_machine_ids ?? []) as string[];
        const seenPreview = seen.slice(0, 6).join(", ") || "none";
        const msg = okHits.length
          ? `iTouching answered (${okHits.length} endpoints) but no jobs matched your ${d?.mapped_machines ?? 0} mapped machines.\nMapped GUIDs: ${mapped.join(", ") || "none"}\nSeen in payload: ${seenPreview}${seen.length > 6 ? ` (+${seen.length - 6} more, see console)` : ""}\nCopy a "Seen" GUID into iTouching Settings → Machines, or click Auto-map all machines.`
          : "iTouching returned nothing for any schedule endpoint. Verify INTOUCH_API_URL/TOKEN or upload the XLSX file.";
        toast.error(msg);
        return;
      }
      const withPlan = await applyRagPlans(secs);
      setSections(withPlan);
      const init: Record<string, { id?: string; name: string }> = {};
      const inc: Record<string, boolean> = {};
      for (const s of withPlan) { init[s.line] = { name: "" }; inc[s.line] = true; }
      setLeaderByLine(init);
      setIncludedLines(inc);
      setParsePreview([]);
      toast.success(`Pulled ${(data as any)?.total_skus ?? 0} SKUs across ${withPlan.length} line${withPlan.length > 1 ? "s" : ""} · qty from RAG Weekly`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not pull from iTouching");
    } finally {
      setPulling(false);
    }
  };

  const runAutoMap = async () => {
    setAutoMapBusy(true);
    setAutoMapPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("intouch-list-machines", {});
      if (error) throw error;
      const machines = ((data as any)?.machines ?? []) as { guid: string; name: string }[];
      if (machines.length === 0) {
        toast.error("iTouching returned no machines");
        return;
      }
      const { data: existing } = await supabase
        .from("intouch_machine_map")
        .select("intouch_machine_id, line_id");
      const existingMap = new Map((existing ?? []).map((r: any) => [r.intouch_machine_id, r.line_id]));

      const preview = machines
        .filter((m) => m.guid)
        .map((m) => {
          const alias = MAP_ALIASES.find((a) => a.intouch.test(m.name));
          let matched: { id: string; name: string } | undefined;
          let reason = "";
          if (alias) {
            const hit = lines.find((l) => alias.dbPatterns.some((p) => p.test(l.name)));
            if (hit) { matched = hit; reason = "alias"; }
          }
          if (!matched) {
            let best: { line: { id: string; name: string }; score: number } | null = null;
            for (const l of lines) {
              const s = similarity(m.name, l.name);
              if (!best || s > best.score) best = { line: l, score: s };
            }
            if (best && best.score >= 0.3) {
              matched = best.line;
              reason = `fuzzy ${best.score.toFixed(2)}`;
            } else {
              reason = `no match (best ${best?.score.toFixed(2) ?? "0"})`;
            }
          }
          const currentLineId = existingMap.get(m.guid) ?? null;
          if (currentLineId && !matched) {
            const cur = lines.find((l) => l.id === currentLineId);
            if (cur) { matched = cur; reason = "existing"; }
          }
          return {
            guid: m.guid,
            intouch_name: m.name || "(unnamed)",
            line_id: matched?.id ?? null,
            line_name: matched?.name ?? "",
            reason,
            include: !!matched,
          };
        })
        .sort((a, b) => Number(b.include) - Number(a.include) || a.intouch_name.localeCompare(b.intouch_name));
      setAutoMapPreview(preview);
      const matched = preview.filter((p) => p.include).length;
      toast.success(`${matched}/${preview.length} machines matched — review and confirm`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-map failed");
    } finally {
      setAutoMapBusy(false);
    }
  };

  const saveAutoMap = async () => {
    if (!autoMapPreview) return;
    const rows = autoMapPreview
      .filter((p) => p.include && p.line_id)
      .map((p) => ({
        intouch_machine_id: p.guid,
        intouch_machine_name: p.intouch_name,
        line_id: p.line_id,
        active: true,
      }));
    if (rows.length === 0) {
      toast.error("Nothing selected to save");
      return;
    }
    setAutoMapSaving(true);
    try {
      const { error } = await supabase
        .from("intouch_machine_map")
        .upsert(rows, { onConflict: "intouch_machine_id" });
      if (error) throw error;
      toast.success(`Saved ${rows.length} machine mapping${rows.length === 1 ? "" : "s"}`);
      setAutoMapPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAutoMapSaving(false);
    }
  };




  const setLeader = (sectionLine: string, value: string) => {
    if (value === "__none") {
      setLeaderByLine((p) => ({ ...p, [sectionLine]: { name: "" } }));
    } else if (value.startsWith("__id:")) {
      const id = value.slice(5);
      const l = leaders.find((x) => x.id === id);
      setLeaderByLine((p) => ({ ...p, [sectionLine]: { id, name: l?.name ?? "" } }));
    } else {
      setLeaderByLine((p) => ({ ...p, [sectionLine]: { name: value } }));
    }
  };

  const quickAddLeader = async (sectionLine: string, name: string) => {
    if (!name.trim()) return;
    try {
      const created = await addLeader.mutateAsync({ name, shift });
      setLeaderByLine((p) => ({ ...p, [sectionLine]: { id: created.id, name: created.name } }));
      toast.success(`Added leader ${created.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not add leader";
      toast.error(msg);
    }
  };

  const doImport = async () => {
    setImporting(true);
    let okSessions = 0;
    let okItems = 0;
    let createdSkus = 0;
    try {
      // Auto-create unknown SKUs so import never fails on missing catalog entries
      const missing = new Map<string, string>();
      for (const sec of activeSections) {
        for (const it of sec.items) {
          if (!it.sku_id) {
            const code = it.sku_code.trim();
            if (code && !missing.has(code.toUpperCase())) {
              missing.set(code.toUpperCase(), (it.description ?? code).trim() || code);
            }
          }
        }
      }
      const newSkuMap = new Map<string, string>();
      if (missing.size > 0) {
        const rows = Array.from(missing.entries()).map(([code, name]) => ({ code, name, active: true }));
        const { data: inserted, error } = await supabase
          .from("sku_products")
          .upsert(rows, { onConflict: "code" })
          .select("id, code");
        if (error) throw error;
        for (const r of inserted ?? []) newSkuMap.set(r.code.toUpperCase(), r.id);
        createdSkus = inserted?.length ?? 0;
      }

      // Merge sections that resolve to the same line so we don't overwrite
      // items when two parsed machines map to the same DB line.
      type Merged = {
        matched_line: string;
        leader?: { id?: string; name: string };
        items: Map<string, { sku_id: string; qty: number }>; // key = sku_id
      };
      const byLine = new Map<string, Merged>();
      for (const sec of activeSections) {
        const targetLine = sec.matched_line ?? sec.line;
        if (!targetLine) continue;
        const m = byLine.get(targetLine) ?? {
          matched_line: targetLine,
          leader: leaderByLine[sec.line],
          items: new Map(),
        };
        if (!m.leader?.name) m.leader = leaderByLine[sec.line] ?? m.leader;
        for (const i of sec.items) {
          const sku_id = i.sku_id ?? newSkuMap.get(i.sku_code.trim().toUpperCase());
          if (!sku_id) continue;
          const ex = m.items.get(sku_id);
          if (ex) ex.qty += i.qty;
          else m.items.set(sku_id, { sku_id, qty: i.qty });
        }
        byLine.set(targetLine, m);
      }

      for (const m of byLine.values()) {
        const session = await upsertSession.mutateAsync({
          session_date: date,
          shift,
          line: m.matched_line,
          leader_id: m.leader?.id ?? null,
          leader_name: m.leader?.name?.trim() || null,
          staff_planned: 0,
          staff_actual: 0,
          notes: null,
        });
        okSessions++;
        const items = Array.from(m.items.values()).map((i) => ({
          sku_id: i.sku_id, target_qty: i.qty, planned_qty: i.qty, actual_qty: 0, notes: null,
        }));
        await saveItems.mutateAsync({ session_id: session.id, items });
        okItems += items.length;
      }
      toast.success(`Imported ${okItems} products across ${okSessions} session${okSessions === 1 ? "" : "s"}${createdSkus ? ` · ${createdSkus} new SKU${createdSkus === 1 ? "" : "s"} created` : ""}`);
      qc.invalidateQueries({ queryKey: ["production_sessions"] });
      qc.invalidateQueries({ queryKey: ["production_items"] });
      qc.invalidateQueries({ queryKey: ["sku_products"] });
      onImported?.();
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(getImportErrorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Import iTouching Work To List
          </DialogTitle>
          <DialogDescription>
            Upload the .xlsx or .csv exported from iTouching. SKUs are grouped per line; assign a leader and import all sessions at once.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Shift</Label>
            <Select value={shift} onValueChange={(v) => setShift(v as "DAY" | "NIGHT")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY">Day (06–18)</SelectItem>
                <SelectItem value="NIGHT">Night (18–06)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              className="hidden"
              onChange={onFile}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              {sections.length ? "Replace file" : "Choose file"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 -mt-1">
          <Button
            type="button"
            onClick={pullFromIntouch}
            disabled={pulling || loading}
            className="gap-2"
          >
            {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Pull scheduled jobs from iTouching
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={async () => { reset(); await pullFromIntouch(); }}
            disabled={pulling || loading}
            className="gap-2"
            title="Clears the current preview and re-pulls fresh data from iTouching"
          >
            {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Force Re-sync
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={runAutoMap}
            disabled={autoMapBusy || pulling}
            className="gap-2"
          >
            {autoMapBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Auto-map all machines
          </Button>
          <span className="text-xs text-muted-foreground">
            Maps iTouching GUIDs to lines so the pull above can find jobs.
          </span>
        </div>

        {autoMapPreview && (
          <div className="border rounded-md p-3 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                Confirm machine mapping ({autoMapPreview.filter((p) => p.include && p.line_id).length}/{autoMapPreview.length} selected)
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAutoMapPreview(null)} disabled={autoMapSaving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveAutoMap} disabled={autoMapSaving}>
                  {autoMapSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Save mappings
                </Button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1 w-8">Use</th>
                    <th className="text-left px-2 py-1">iTouching machine</th>
                    <th className="text-left px-2 py-1">Line</th>
                    <th className="text-left px-2 py-1">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {autoMapPreview.map((p, i) => (
                    <tr key={p.guid} className="border-t">
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={p.include && !!p.line_id}
                          disabled={!p.line_id}
                          onChange={(e) =>
                            setAutoMapPreview((prev) =>
                              prev ? prev.map((r, j) => (j === i ? { ...r, include: e.target.checked } : r)) : prev,
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="font-medium">{p.intouch_name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{p.guid}</div>
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={p.line_id ?? "__none"}
                          onValueChange={(v) =>
                            setAutoMapPreview((prev) =>
                              prev
                                ? prev.map((r, j) =>
                                    j === i
                                      ? {
                                          ...r,
                                          line_id: v === "__none" ? null : v,
                                          line_name: v === "__none" ? "" : (lines.find((l) => l.id === v)?.name ?? ""),
                                          include: v !== "__none",
                                        }
                                      : r,
                                  )
                                : prev,
                            )
                          }
                        >
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— none —</SelectItem>
                            {lines.map((l) => (
                              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        {p.line_id ? (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Check className="h-3 w-3" />{p.reason}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <X className="h-3 w-3" />{p.reason}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}




        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {resolved.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 border rounded-md px-4 space-y-4">
              <div className="text-center">
                No file loaded. Upload an iTouching export to see lines and SKUs grouped here.
              </div>
              {parsePreview.length > 0 && (
                <div className="text-left space-y-2">
                  <div className="font-medium text-foreground">File preview</div>
                  <div className="overflow-x-auto rounded-md border bg-muted/20">
                    <table className="w-full text-xs">
                      <tbody>
                        {parsePreview.map((row, rowIdx) => (
                          <tr key={rowIdx} className="border-t first:border-t-0">
                            {row.map((cell, cellIdx) => (
                              <td key={cellIdx} className="px-2 py-1 max-w-[180px] truncate border-r last:border-r-0">
                                {cell || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
            <div className="flex items-center justify-between gap-2 px-1 py-2 text-xs text-muted-foreground">
              <div>Select which lines to import (scheduled to work this shift):</div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => setIncludedLines(Object.fromEntries(resolved.map((s) => [s.line, true])))}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => setIncludedLines(Object.fromEntries(resolved.map((s) => [s.line, false])))}>
                  Clear
                </Button>
              </div>
            </div>
            <Accordion type="multiple" className="w-full">
              {resolved.map((sec) => {
                const lead = leaderByLine[sec.line] ?? { name: "" };
                const selectValue = lead.id ? `__id:${lead.id}` : "__none";
                const included = includedLines[sec.line] !== false;
                return (
                  <AccordionItem key={sec.line} value={sec.line}>
                    <AccordionTrigger className={`hover:no-underline ${!included ? "opacity-50" : ""}`}>
                      <div className="flex items-center gap-3 flex-1 pr-3">
                        <input
                          type="checkbox"
                          checked={included}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setIncludedLines((p) => ({ ...p, [sec.line]: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <span className="font-medium text-left flex-1 truncate">{sec.line}</span>
                        {sec.matched_line ? (
                          <Badge variant="outline" className="text-xs">{sec.matched_line}</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="h-3 w-3" />No match
                          </Badge>
                        )}
                        <Badge>{sec.items.filter((i) => i.sku_id).length} SKUs</Badge>
                        <Badge variant="secondary" className="text-xs tabular-nums">
                          Σ {sec.items.reduce((a, i) => a + (i.qty || 0), 0).toLocaleString()}
                        </Badge>
                        {sec.unknown > 0 && (
                          <Badge variant="secondary" className="text-xs">{sec.unknown} unknown</Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pt-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Leader (existing)</Label>
                            <Select value={selectValue} onValueChange={(v) => setLeader(sec.line, v)}>
                              <SelectTrigger><SelectValue placeholder="Select leader…" /></SelectTrigger>
                              <SelectContent>
                                {leaders.length === 0 && (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No leaders for {shift} shift</div>
                                )}
                                {leaders.map((l) => (
                                  <SelectItem key={l.id} value={`__id:${l.id}`}>{l.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Or type a new leader name</Label>
                            <div className="flex gap-2">
                              <Input
                                placeholder="New leader name"
                                value={lead.id ? "" : lead.name}
                                onChange={(e) => setLeader(sec.line, e.target.value)}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => quickAddLeader(sec.line, lead.name)}
                                disabled={!lead.name.trim() || !!lead.id}
                              >
                                Save
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="border rounded-md overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-xs">
                              <tr>
                                <th className="text-left px-3 py-2 w-10">#</th>
                                <th className="text-left px-3 py-2">Status</th>
                                <th className="text-left px-3 py-2">SKU</th>
                                <th className="text-left px-3 py-2">Product Description</th>
                                <th className="text-right px-3 py-2">Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.items.map((i, idx) => {
                                const running = (i as any).status === "Running";
                                return (
                                  <tr key={`${i.sku_code}-${idx}`} className={`border-t ${running ? "bg-primary/10" : ""}`}>
                                    <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                                    <td className="px-3 py-1.5">
                                      {running ? (
                                        <Badge className="text-[10px] bg-green-600 hover:bg-green-600">RUNNING</Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-[10px]">Scheduled</Badge>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 font-mono text-xs">
                                      {i.sku_id ? (
                                        <span className="text-green-500">{i.sku_name}</span>
                                      ) : (
                                        <span className="text-amber-500">{i.sku_code}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[320px]">{i.description ?? ""}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{i.qty.toLocaleString()}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
            </>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <div className="flex-1 text-xs text-muted-foreground">
            {resolved.length > 0 && (
              <>
                {totalProducts} products · {totalLines} lines
                {resolved.some((s) => !s.matched_line) && " · Some lines do not match catalog"}
              </>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Cancel</Button>
          <Button onClick={doImport} disabled={!canImport || importing}>
            {importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Import {totalProducts} Products ({totalLines} Lines)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
