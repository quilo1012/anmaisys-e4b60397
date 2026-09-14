/**
 * A matriz semanal das esperas do armazém.
 *
 * A mesma tabela dia × turno que a manutenção mostra para as avarias, sobre as
 * ordens que o poll do iTouching abre quando uma linha entra em
 * "Warehouse/Awaiting Packaging". A pergunta é a mesma — que linha esteve
 * parada, em que dia, em que turno — e a resposta sai da mesma função.
 *
 * O que NÃO acontece aqui é somar isto ao downtime de produção. Continua fora,
 * como o cabeçalho do ecrã promete.
 *
 * Sem filtro de turno de propósito: as colunas Dia/Noite JÁ são a repartição por
 * turno, e escondê-las faria a lista por baixo da tabela deixar de contar as
 * mesmas esperas que as células.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { DateRangeFilter, getPresetRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { PatternMatrixCard } from "@/components/PatternMatrixCard";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useToast } from "@/hooks/use-toast";
import { computeHeatmap } from "@/lib/downtimeHeatmap";
import { formatDurationCompact } from "@/lib/formatDuration";
import { buildReportMatrix, matrixToSheetRows } from "@/lib/patternMatrixReport";
import { resolveReportRange } from "@/lib/reportRange";
import { filterWarehouseWaits, toWarehouseHeatmapRecords } from "@/lib/warehouseHeatmap";
import { formatWarehouseWait } from "@/lib/warehouseWait";

/**
 * Uma duração desta matriz, escrita como a coluna "Wait" já a escreve.
 *
 * A manutenção imprime "0h 45m" porque as suas paragens contam-se em horas. As
 * esperas do armazém ficam quase todas abaixo da hora — 5 a 28 minutos de média
 * — e catorze colunas de "0h" à frente do número são exactamente o ruído que o
 * `formatDurationCompact` foi escrito para tirar. Ver `warehouseWait.ts`.
 */
const fmtWait = (minutes: number) => formatDurationCompact(minutes * 60);

/** A fila da matriz para quem chegou sem linha — um pedido escrito à mão. */
const NO_LINE_LABEL = "(no line)";

const INITIAL_PRESET: DateRangePreset = "7d";

function isOpenWait(wo: { closed_at?: string | null; finished_at?: string | null }) {
  return !wo.closed_at && !wo.finished_at;
}

export function WarehousePatternMatrix() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const initial = useMemo(() => getPresetRange(INITIAL_PRESET), []);
  const [startDate, setStartDate] = useState<Date>(initial.from ?? new Date());
  const [endDate, setEndDate] = useState<Date>(initial.to ?? new Date());
  const [datePreset, setDatePreset] = useState<DateRangePreset>(INITIAL_PRESET);
  const [lineFilter, setLineFilter] = useState("all");

  const fromMs = startDate.getTime();
  const toMs = endDate.getTime();

  // Com intervalo, e não sem ele: sem `from`/`to` este hook devolve as 200 ordens
  // mais recentes, e as do armazém são uma minoria delas — um período de 30 dias
  // seria calculado sobre as ordens que couberam, sem dizer que faltavam as outras.
  const { data: workOrders, isLoading } = useWorkOrders({ from: startDate, to: endDate });

  const inRange = useMemo(
    () => filterWarehouseWaits(workOrders as never[] | undefined, { fromMs, toMs }),
    [workOrders, fromMs, toMs],
  );
  const waits = useMemo(
    () => filterWarehouseWaits(workOrders as never[] | undefined, { fromMs, toMs, line: lineFilter }),
    [workOrders, fromMs, toMs, lineFilter],
  );

  const lineOptions = useMemo(() => {
    const set = new Set<string>();
    inRange.forEach((w: { line_at_time?: string | null }) => set.add(w.line_at_time ?? "—"));
    return Array.from(set).sort((a, b) => {
      const ma = /line\s*(\d+)/i.exec(a)?.[1];
      const mb = /line\s*(\d+)/i.exec(b)?.[1];
      if (ma && mb) return Number(ma) - Number(mb);
      return a.localeCompare(b);
    });
  }, [inRange]);

  const heatmap = useMemo(
    () => computeHeatmap(toWarehouseHeatmapRecords(waits), fromMs, toMs, "all", "all"),
    [waits, fromMs, toMs],
  );

  const kpis = useMemo(() => {
    let lineMinutes = 0, count = 0, lineSystemMinutes = 0;
    heatmap.lineTotals.forEach((c) => {
      lineMinutes += c.minutes; count += c.count; lineSystemMinutes += c.systemMinutes;
    });
    return {
      totalWait: heatmap.grandTotalMinutes,
      // A parte que ninguém mediu. Sem isto o cartão diz "94h 48m" e 92h50m
      // delas são uma ordem de teste que esteve aberta quatro dias — um número
      // que se lê primeiro, se cita numa reunião, e não é uma espera.
      totalUnmeasured: heatmap.grandSystemMinutes,
      lineWait: lineMinutes,
      lineUnmeasured: lineSystemMinutes,
      waits: count,
      linesAffected: heatmap.lines.length,
      openNow: waits.filter(isOpenWait).length,
    };
  }, [heatmap, waits]);

  const rangeLabel = `${format(startDate, "PP")} — ${format(endDate, "PP")}`;
  const filtersLabel = `Line: ${lineFilter === "all" ? "All" : lineFilter === "—" ? NO_LINE_LABEL : lineFilter}`;

  const reportMatrix = useMemo(
    () => buildReportMatrix(heatmap, { emptyRowLabel: NO_LINE_LABEL, format: fmtWait }),
    [heatmap],
  );

  const waitRows = useMemo(
    () =>
      [...waits]
        .sort((a: { created_at: string }, b: { created_at: string }) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((w: Record<string, string | null>) => ({
          line: w.line_at_time ?? NO_LINE_LABEL,
          machine: w.machine ?? "—",
          reason: w.description ?? "—",
          started: format(new Date(w.created_at as string), "dd/MM HH:mm"),
          wait: formatWarehouseWait(w as never),
          status: isOpenWait(w) ? "Ongoing" : "Closed",
        })),
    [waits],
  );

  const handleExportPdf = async () => {
    try {
      const { generateWarehouseReportPDF } = await import("@/lib/warehouseReport");
      const input = {
        rangeLabel,
        filtersLabel,
        kpis: {
          totalWait: fmtWait(kpis.totalWait),
          totalUnmeasured: kpis.totalUnmeasured > 0 ? fmtWait(kpis.totalUnmeasured) : undefined,
          lineWait: fmtWait(kpis.lineWait),
          waits: kpis.waits,
          linesAffected: kpis.linesAffected,
          openNow: kpis.openNow,
        },
        waits: waitRows,
        matrix: reportMatrix,
      };
      const url = await generateWarehouseReportPDF(input, { output: "bloburl" });
      const w = url ? window.open(url, "_blank") : null;
      if (!w) await generateWarehouseReportPDF(input);
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to generate PDF",
        variant: "destructive",
      });
    }
  };

  const handleExportXlsx = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        waitRows.length
          ? waitRows.map((w) => ({
              Line: w.line, Asset: w.machine, Reason: w.reason,
              Started: w.started, Wait: w.wait, Status: w.status,
            }))
          : [{ Line: "", Asset: "", Reason: "No warehouse waits in the selected range.", Started: "", Wait: "", Status: "" }],
      ),
      "Warehouse Waits",
    );
    if (reportMatrix) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrixToSheetRows(reportMatrix)), "Pattern Matrix");
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Metric: "Range Start", Value: format(startDate, "yyyy-MM-dd") },
        { Metric: "Range End", Value: format(endDate, "yyyy-MM-dd") },
        { Metric: "Line", Value: lineFilter === "all" ? "All" : lineFilter },
        { Metric: "Total wait (wall-clock)", Value: fmtWait(kpis.totalWait) },
        { Metric: "…of which not closed by the poll", Value: fmtWait(kpis.totalUnmeasured) },
        { Metric: "Line time waiting", Value: fmtWait(kpis.lineWait) },
        { Metric: "Waits", Value: kpis.waits },
        { Metric: "Lines affected", Value: kpis.linesAffected },
        { Metric: "Open now", Value: kpis.openNow },
        { Metric: "Note", Value: "Warehouse waits never count as production-line downtime." },
      ]),
      "Summary",
    );
    XLSX.writeFile(wb, `warehouse-waits_${format(startDate, "yyyy-MM-dd")}_${format(endDate, "yyyy-MM-dd")}.xlsx`);
  };

  const unmeasured = (minutes: number) =>
    minutes > 0 ? `${fmtWait(minutes)} not closed by the poll` : undefined;

  const kpiCards = [
    { label: "Total wait", value: fmtWait(kpis.totalWait), note: unmeasured(kpis.totalUnmeasured), hint: "Wall-clock. Lines waiting in parallel counted once." },
    { label: "Line time waiting", value: fmtWait(kpis.lineWait), note: unmeasured(kpis.lineUnmeasured), hint: "The same time, counted once per line that was stopped." },
    { label: "Waits", value: String(kpis.waits), note: undefined, hint: "Warehouse orders that overlap the range." },
    { label: "Lines affected", value: String(kpis.linesAffected), note: undefined, hint: "Distinct lines that waited at least once." },
    { label: "Open now", value: String(kpis.openNow), note: undefined, hint: "Still waiting — counted up to this moment." },
  ];

  return (
    <>
      <style>{`
        @media print {
          /* margin 0 para o browser não imprimir o seu próprio cabeçalho (que
             traz o URL); o espaço volta como padding aqui dentro. */
          @page { size: A4 landscape; margin: 0; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .warehouse-print-root, .warehouse-print-root * { visibility: visible !important; }
          /* A casca fica invisível mas continua a ocupar o seu h-screen, e é essa
             página de nada que sai a seguir ao relatório. Colapsá-la tira-a. */
          #root [class*="h-screen"], #root [class*="min-h-screen"], #root main {
            height: auto !important; min-height: 0 !important; max-height: none !important;
          }
          .warehouse-print-root {
            position: absolute; left: 0; top: 0; width: 100%;
            padding: 12mm !important;
            color: #000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .warehouse-print-root .print-only { display: block !important; }
          .warehouse-print-root .no-print { display: none !important; }
          .warehouse-print-root table { width: 100% !important; border-collapse: collapse !important; font-size: 10px !important; }
          .warehouse-print-root thead { display: table-header-group !important; }
          .warehouse-print-root tfoot { display: table-footer-group !important; }
          .warehouse-print-root tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          .warehouse-print-root th, .warehouse-print-root td {
            border: 1px solid #999 !important; padding: 4px 6px !important;
            color: #000 !important; background: #fff !important;
          }
          .warehouse-print-root th { background: #f0f0f0 !important; font-weight: 700 !important; }
          .warehouse-print-root [class*="min-w-"] { min-width: 0 !important; }
        }
        .warehouse-print-root .print-only { display: none; }
      `}</style>

      <div className="warehouse-print-root space-y-4">
        {/* Cabeçalho só para o papel — uma folha sem período não se arquiva. */}
        <div className="print-only" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #000", paddingBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src="/favicon.png" alt="AN" style={{ height: 36, width: 36 }} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Warehouse Waits</div>
                <div style={{ fontSize: 10, color: "#333" }}>{rangeLabel}</div>
              </div>
            </div>
            <div style={{ fontSize: 10, textAlign: "right", color: "#333" }}>
              <div>{filtersLabel}</div>
              <div>Generated: {format(new Date(), "yyyy-MM-dd HH:mm")}</div>
              <div>Warehouse waits never count as production-line downtime.</div>
            </div>
          </div>
        </div>

        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Warehouse Wait Pattern</h2>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter
              value={{ from: startDate, to: endDate }}
              preset={datePreset}
              storageKey="warehouse-pattern"
              onChange={(range, preset) => {
                setDatePreset(preset);
                // "All time" chega como intervalo aberto. Sem isto, o chip diria
                // uma coisa e os números seriam outra — ver `reportRange.ts`.
                const resolved = resolveReportRange(range);
                const r = preset === "all" ? { from: resolved.startDate, to: resolved.endDate } : range;
                if (r.from) setStartDate(r.from);
                setEndDate(r.to ?? new Date());
              }}
            />
            <Select value={lineFilter} onValueChange={setLineFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Line" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lines</SelectItem>
                {lineOptions.map((l) => (
                  <SelectItem key={l} value={l}>{l === "—" ? NO_LINE_LABEL : l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
              <Button size="sm" variant="ghost" onClick={handleExportPdf} title="Export PDF">
                <FileText className="h-4 w-4 mr-1.5" /> PDF
              </Button>
              <Button size="sm" variant="ghost" onClick={handleExportXlsx} title="Export Excel">
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.print()} title="Print">
                <Printer className="h-4 w-4 mr-1.5" /> Print
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {kpiCards.map((k) => (
                <Card key={k.label}>
                  <CardContent className="p-4" title={k.hint}>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
                    {k.note && (
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        <span className="align-super opacity-70">†</span> {k.note}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <PatternMatrixCard
              title="Pattern Matrix — warehouse wait"
              description={
                <>
                  Cells show how long each line waited on the warehouse, by day and shift.
                  Totals are wall-clock — lines waiting in parallel counted once. Europe/London time.
                  A dagger marks a cell that is mostly time the iTouching poll did not close: somebody
                  forced the order shut later, so it says the line was flagged, not for how long it
                  waited. These minutes never count as production-line downtime.
                </>
              }
              heatmap={heatmap}
              fromMs={fromMs}
              toMs={toMs}
              shiftFilter="all"
              rowHeader="Line"
              emptyRowLabel={NO_LINE_LABEL}
              emptyMessage="No warehouse waits in the selected range."
              showUnresumed
              unresumedLegend="† not closed by the poll"
              unresumedNote={(t) => ` — ${t} of it on an order somebody force-closed later, not a measured wait`}
              countNoun="waits"
              formatCell={fmtWait}
            />

            <Card>
              <CardHeader>
                <CardTitle>Waits in this range ({waitRows.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {waits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No warehouse waits in the selected range.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Line</TableHead>
                          <TableHead>Asset</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Started</TableHead>
                          <TableHead className="text-right">Wait</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...waits]
                          .sort((a: { created_at: string }, b: { created_at: string }) =>
                            new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                          .map((w: Record<string, string | null>) => (
                            <TableRow
                              key={w.id as string}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => navigate(`/dashboard/wo/${w.id}`)}
                            >
                              <TableCell className="font-medium whitespace-nowrap">
                                {w.line_at_time ?? <span className="italic text-muted-foreground">{NO_LINE_LABEL}</span>}
                              </TableCell>
                              <TableCell>{w.machine || "—"}</TableCell>
                              <TableCell className="max-w-[280px] truncate">{w.description || "—"}</TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">
                                {format(new Date(w.created_at as string), "dd/MM HH:mm")}
                              </TableCell>
                              <TableCell className={`text-right tabular-nums whitespace-nowrap ${isOpenWait(w) ? "font-medium" : "text-muted-foreground"}`}>
                                {formatWarehouseWait(w as never)}
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={(w.status as string) ?? "closed"} showIcon />
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
