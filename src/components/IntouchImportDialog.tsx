import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Upload, FileSpreadsheet, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseIntouchWorkToList, type WorkToListSection } from "@/lib/intouchWorkToList";
import { useLines, useSkuProducts, useUpsertSession, useSaveItems } from "@/hooks/useProductionPlanner";
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
  // XLSX/XLS via exceljs
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const buf = await file.arrayBuffer();
  await wb.xlsx.load(buf);
  const lines: string[] = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const max = row.cellCount;
      for (let i = 1; i <= max; i++) {
        const v = row.getCell(i).value as unknown;
        let s = "";
        if (v == null) s = "";
        else if (typeof v === "object" && v !== null && "text" in (v as any)) s = String((v as any).text ?? "");
        else if (typeof v === "object" && v !== null && "result" in (v as any)) s = String((v as any).result ?? "");
        else s = String(v);
        s = s.replace(/"/g, '""');
        cells.push(`"${s}"`);
      }
      lines.push(cells.join(","));
    });
  });
  return lines.join("\n");
}

function normalizeLine(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function IntouchImportDialog({ open, onOpenChange, defaultDate, defaultShift = "DAY", onImported }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [date, setDate] = useState(defaultDate ?? format(new Date(), "yyyy-MM-dd"));
  const [shift, setShift] = useState<"DAY" | "NIGHT">(defaultShift);
  const [sections, setSections] = useState<WorkToListSection[]>([]);
  const [leaderByLine, setLeaderByLine] = useState<Record<string, { id?: string; name: string }>>({});

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

  const resolved = useMemo(() => sections.map((sec) => {
    const matched = lineByNorm.get(normalizeLine(sec.line));
    const items = sec.items.map((it) => {
      const sku = skuByCode.get(it.sku_code.toUpperCase());
      return { ...it, sku_id: sku?.id, sku_name: sku?.name };
    });
    const unknown = items.filter((i) => !i.sku_id).length;
    return { ...sec, matched_line: matched, items, unknown };
  }), [sections, lineByNorm, skuByCode]);

  const totalProducts = resolved.reduce((a, s) => a + s.items.filter((i) => i.sku_id).length, 0);
  const totalLines = resolved.length;
  const canImport = totalProducts > 0
    && resolved.every((s) => s.matched_line && (leaderByLine[s.line]?.name?.trim()?.length ?? 0) > 0);

  const reset = () => {
    setSections([]);
    setLeaderByLine({});
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setLoading(true);
    try {
      const text = await readFileAsCsv(f);
      const parsed = parseIntouchWorkToList(text);
      if (parsed.length === 0) {
        toast.error("No Work To List sections detected in this file");
        return;
      }
      setSections(parsed);
      // pre-fill leader from active list (first available leader for shift)
      const init: Record<string, { id?: string; name: string }> = {};
      for (const s of parsed) init[s.line] = { name: "" };
      setLeaderByLine(init);
      toast.success(`Detected ${parsed.length} line${parsed.length > 1 ? "s" : ""}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read file";
      toast.error(msg);
    } finally {
      setLoading(false);
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
    try {
      for (const sec of resolved) {
        if (!sec.matched_line) continue;
        const lead = leaderByLine[sec.line];
        const session = await upsertSession.mutateAsync({
          session_date: date,
          shift,
          line: sec.matched_line,
          leader_id: lead?.id ?? null,
          leader_name: lead?.name?.trim() || null,
          staff_planned: 0,
          staff_actual: 0,
          notes: null,
        });
        okSessions++;
        const items = sec.items
          .filter((i) => i.sku_id)
          .map((i) => ({
            sku_id: i.sku_id!,
            target_qty: i.qty,
            planned_qty: i.qty,
            actual_qty: 0,
            notes: null,
          }));
        await saveItems.mutateAsync({ session_id: session.id, items });
        okItems += items.length;
      }
      toast.success(`Imported ${okItems} products across ${okSessions} session${okSessions === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["production_sessions"] });
      qc.invalidateQueries({ queryKey: ["production_items"] });
      onImported?.();
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      toast.error(msg);
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

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {resolved.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12 border rounded-md">
              No file loaded. Upload an iTouching export to see lines and SKUs grouped here.
            </div>
          ) : (
            <Accordion type="multiple" className="w-full">
              {resolved.map((sec) => {
                const lead = leaderByLine[sec.line] ?? { name: "" };
                const selectValue = lead.id ? `__id:${lead.id}` : "__none";
                return (
                  <AccordionItem key={sec.line} value={sec.line}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 flex-1 pr-3">
                        <span className="font-medium text-left flex-1 truncate">{sec.line}</span>
                        {sec.matched_line ? (
                          <Badge variant="outline" className="text-xs">{sec.matched_line}</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="h-3 w-3" />No match
                          </Badge>
                        )}
                        <Badge>{sec.items.filter((i) => i.sku_id).length} SKUs</Badge>
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
                                <th className="text-left px-3 py-2">Code</th>
                                <th className="text-left px-3 py-2">Description</th>
                                <th className="text-right px-3 py-2">Qty</th>
                                <th className="text-left px-3 py-2">Catalog</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.items.map((i, idx) => (
                                <tr key={`${i.sku_code}-${idx}`} className="border-t">
                                  <td className="px-3 py-1.5 font-mono text-xs">{i.sku_code}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[280px]">{i.description ?? ""}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums">{i.qty.toLocaleString()}</td>
                                  <td className="px-3 py-1.5">
                                    {i.sku_id ? (
                                      <span className="text-xs text-green-500">{i.sku_name}</span>
                                    ) : (
                                      <span className="text-xs text-amber-500">Unknown SKU</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
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
