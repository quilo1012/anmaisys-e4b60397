import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { usePmSchedules, useUpdatePmSchedule, useCreatePmSchedule } from "@/hooks/usePreventiveMaintenance";
import { useRole } from "@/hooks/useRole";
import { toast } from "sonner";
import {
  Brain, CheckCircle2, ArrowLeftRight, CalendarPlus, Activity,
  Printer, Loader2, ChevronDown, ChevronRight, Wrench,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/reports/KpiCard";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { printElementAsDocument } from "@/lib/printDocument";
import { PreventiveOpportunities } from "@/components/PreventiveOpportunities";
import {
  DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset,
} from "@/components/DateRangeFilter";
import { resolveReportRange, reportPeriodLabel, reportSpanPhrase } from "@/lib/reportRange";
import {
  buildAssetIndex, buildPmAssetRows, PM_FLOOR_DAYS, MTBF_FRACTION,
  type PmAssetRow, type Verdict,
} from "@/lib/pmIntelligence";
import { cn } from "@/lib/utils";

/**
 * Cada veredicto dito uma vez, no sítio onde manda: no cabeçalho do seu bloco.
 *
 * A versão anterior repetia um badge de estado em cada uma das 23 linhas, e a coluna
 * inteira dizia a mesma coisa porque não havia plano nenhum na base. Um rótulo
 * repetido 23 vezes não informa — separa. As linhas passam a estar agrupadas pelo que
 * há a fazer com elas, e a frase que explica o grupo é dita uma vez, por cima dele.
 */
const DECKS: {
  verdict: Verdict;
  title: string;
  blurb: string;
  tone: "danger" | "warning" | "info" | "ok" | "muted";
}[] = [
  {
    verdict: "chronic",
    title: "Fails faster than any PM cycle",
    blurb:
      `These break down more often than once every ${Math.round(PM_FLOOR_DAYS / MTBF_FRACTION)} days. ` +
      "No service interval catches that — the recurring problem is what needs solving, so they are " +
      "listed in Preventive work opportunities above rather than given an interval here.",
    tone: "danger",
  },
  {
    verdict: "plan",
    title: "Ready for a plan",
    blurb: "The failure rate supports a service interval and no schedule exists yet.",
    tone: "warning",
  },
  {
    verdict: "adjust",
    title: "Interval has drifted",
    blurb: "A schedule exists, and the evidence since it was set says a different number.",
    tone: "info",
  },
  {
    verdict: "calibrated",
    title: "Calibrated",
    blurb: "The schedule already matches what the failures say. Nothing to do.",
    tone: "ok",
  },
  {
    verdict: "aggregate",
    title: "Recorded against a line",
    blurb:
      "These orders name a production line, which is several serviceable machines. The interval " +
      "between them is the sum of all of them, so it says nothing about when any one should be serviced.",
    tone: "muted",
  },
  {
    verdict: "sparse",
    title: "Too few failures to measure",
    blurb: "One failure in the period. There is no time between failures to read.",
    tone: "muted",
  },
];

const TONE_TEXT: Record<string, string> = {
  danger: "text-destructive-strong",
  warning: "text-warning-strong",
  info: "text-primary",
  ok: "text-success-strong",
  muted: "text-muted-foreground",
};

/** As quatro que pedem uma decisão. As outras duas explicam-se, não se contam. */
const ACTIONABLE: Verdict[] = ["chronic", "plan", "adjust", "calibrated"];

export default function PMIntelligencePage() {
  const navigate = useNavigate();
  const { can } = useRole();
  /**
   * Aplicar e criar planos é `pm.manage`, ver é `pm.view`.
   *
   * A rota admite supervisor, planner e engineer, que têm `pm.view` e não têm
   * `pm.manage` — e a página oferecia-lhes na mesma o botão que escreve em
   * `pm_schedules`. O RLS recusaria, mas depois do clique e sem dizer porquê.
   */
  const canManage = can("pm.manage");

  /**
   * O período, escolhido, e não noventa dias escritos à mão.
   *
   * Era `useMemo(() => ..., [])` com 90 dias fixos, o cabeçalho de impressão dizia
   * "Last 90 days" sem uma única data, e não havia forma de perguntar outra coisa. O
   * período é agora o mesmo controlo que o resto dos relatórios usa, guardado entre
   * visitas, e tudo o que está por baixo — KPIs, tabela, cartão de oportunidades e o
   * papel — lê-o do mesmo sítio.
   */
  const [preset, setPreset] = useState<DateRangePreset>("90d");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("90d"));
  const period = useMemo(() => resolveReportRange(range), [range]);
  const { startDate, endDate } = period;

  const { data: wos, isLoading: woLoading } = useWorkOrders({ from: startDate, to: endDate });
  const { data: schedules, isLoading: pmLoading } = usePmSchedules();
  const { data: lines, isLoading: linesLoading } = useLines();
  const { data: machines, isLoading: machinesLoading } = useMachines();

  const updatePm = useUpdatePmSchedule();
  const createPm = useCreatePmSchedule();
  const [busyAsset, setBusyAsset] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<PmAssetRow | null>(null);
  const [filter, setFilter] = useState<Verdict | "all">("all");
  const [openDecks, setOpenDecks] = useState<Partial<Record<Verdict, boolean>>>({ sparse: false });

  /**
   * O registo de activos tem de estar carregado antes de a tabela dizer o que é uma
   * linha. Sem isto, as linhas apareciam um instante como máquinas — com botão de
   * aplicar e tudo — e só depois se corrigiam sozinhas.
   */
  const isLoading = woLoading || pmLoading || linesLoading || machinesLoading;

  const assetIndex = useMemo(() => buildAssetIndex(lines, machines), [lines, machines]);

  const { rows, coverage, windowDays } = useMemo(
    () => buildPmAssetRows(wos, schedules, { from: startDate, to: endDate, assetIndex }),
    [wos, schedules, startDate, endDate, assetIndex],
  );

  const counts = useMemo(() => {
    const c = {} as Record<Verdict, number>;
    for (const d of DECKS) c[d.verdict] = 0;
    for (const r of rows) c[r.verdict] += 1;
    return c;
  }, [rows]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.verdict === filter);
  // Do mesmo sítio que o chip do período, senão o ecrã diz dois números para a mesma
  // janela: "Last 90 days" em cima e "the 89 days to…" quatro linhas abaixo.
  const periodPhrase = reportSpanPhrase(period);

  const applyInterval = async (row: PmAssetRow, days: number) => {
    if (!row.scheduleId) return;
    setBusyAsset(row.asset);
    try {
      await updatePm.mutateAsync({ id: row.scheduleId, interval_days: days });
      toast.success(`${row.asset} is now serviced every ${days} days`);
    } catch (e) {
      toast.error((e as Error).message || "Could not update the schedule");
    } finally {
      setBusyAsset(null);
    }
  };

  return (
    <DashboardLayout>
      <div id="pm-intelligence-print" className="space-y-6 print-content">
        <ReportPrintHeader
          title="PM Intelligence"
          periodLabel={reportPeriodLabel(period)}
          filtersLabel={`Service interval = ${Math.round(MTBF_FRACTION * 100)}% of measured MTBF · floor ${PM_FLOOR_DAYS} days`}
        />

        <PageHeader
          className="print:hidden"
          title="PM Intelligence"
          description="Reads the failure record per asset and says what the service interval should be — or why no interval will help."
          icon={<Brain className="h-5 w-5" />}
          actions={
            <>
              <DateRangeFilter
                value={range}
                preset={preset}
                storageKey="pm-intelligence"
                onChange={(r, p) => { setRange(r); setPreset(p); }}
              />
              <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/dashboard/preventive")}>
                <Wrench className="h-4 w-4" /> Schedules
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                const el = document.getElementById("pm-intelligence-print");
                try {
                  // Landscape: uma tabela em papel não faz scroll, perde as colunas da direita.
                  if (el) await printElementAsDocument(el, "PM Intelligence", { landscape: true });
                } catch (err) {
                  toast.error((err as Error)?.message ?? "Could not open the print dialog.");
                }
              }}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            </>
          }
        />

        {/* As quatro decisões possíveis, antes das linhas que as sustentam. Cada
            mosaico filtra a tabela pelo seu próprio grupo — o mesmo gesto que os
            KPIs do ecrã de Preventive Maintenance, para os dois se lerem igual. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 print:grid-cols-4 print:gap-2">
          <KpiCard
            icon={<Activity className="h-5 w-5" />}
            /* O mosaico e o bloco que ele filtra dizem a mesma coisa pelas mesmas
               palavras. Diziam "Fails too often for PM" e "Fails faster than any PM
               cycle", e quem clica num não tem como saber que chegou ao outro. */
            label="Fails faster than PM"
            value={counts.chronic ?? 0}
            sublabel="Needs the cause fixed, not a shorter interval"
            toneValue accent="danger" loading={isLoading}
            onClick={() => setFilter((f) => (f === "chronic" ? "all" : "chronic"))}
            active={filter === "chronic"}
          />
          <KpiCard
            icon={<CalendarPlus className="h-5 w-5" />}
            label="Ready for a plan"
            value={counts.plan ?? 0}
            sublabel="Interval measurable, no schedule yet"
            toneValue accent="warning" loading={isLoading}
            onClick={() => setFilter((f) => (f === "plan" ? "all" : "plan"))}
            active={filter === "plan"}
          />
          <KpiCard
            icon={<ArrowLeftRight className="h-5 w-5" />}
            label="Interval has drifted"
            value={counts.adjust ?? 0}
            sublabel="Schedule and evidence disagree"
            toneValue accent="info" loading={isLoading}
            onClick={() => setFilter((f) => (f === "adjust" ? "all" : "adjust"))}
            active={filter === "adjust"}
          />
          <KpiCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Calibrated"
            value={counts.calibrated ?? 0}
            sublabel="Schedule matches the failures"
            toneValue accent="ok" loading={isLoading}
            onClick={() => setFilter((f) => (f === "calibrated" ? "all" : "calibrated"))}
            active={filter === "calibrated"}
          />
        </div>

        {/* De que é que estes números são feitos. Uma recomendação tirada de um terço
            da evidência deve dizê-lo, e o que ficou de fora não é o mesmo que o que
            foi excluído de propósito. */}
        {!isLoading && (
          <p className="text-2xs leading-relaxed text-muted-foreground">
            Read from <b className="font-figure">{coverage.named}</b> of{" "}
            <b className="font-figure">{coverage.considered}</b> maintenance orders in {periodPhrase}.
            {coverage.unnamed > 0 && (
              <> <span className="font-figure">{coverage.unnamed}</span> name no asset and cannot be grouped.</>
            )}
            {coverage.excluded > 0 && (
              <> <span className="font-figure">{coverage.excluded}</span> preventive or warehouse orders are
                excluded — they are not breakdowns.</>
            )}{" "}
            Repair times come from the <span className="font-figure">{coverage.timed}</span> that carry both a
            start and a finish. MTBF is failures over the period, and the interval is{" "}
            {Math.round(MTBF_FRACTION * 100)}% of it.
          </p>
        )}

        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <PreventiveOpportunities
            workOrders={wos}
            windowDays={windowDays}
            periodLabel={periodPhrase}
          />
        )}

        {isLoading ? (
          <Skeleton className="h-96" />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No maintenance orders name an asset in this period.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Service intervals</CardTitle>
                  <CardDescription>
                    One asset per row, grouped by what the failure record says to do about it.
                  </CardDescription>
                </div>
                {filter !== "all" && (
                  <Button variant="ghost" size="sm" className="print:hidden" onClick={() => setFilter("all")}>
                    Show all {rows.length} assets
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto pt-0">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-2 font-medium">Asset</th>
                    <th className="p-2 text-right font-medium">Failures</th>
                    <th className="p-2 text-right font-medium">MTBF</th>
                    <th className="p-2 text-right font-medium">MTTR</th>
                    <th className="p-2 text-right font-medium">Current</th>
                    <th className="p-2 text-right font-medium">Recommended</th>
                    <th className="p-2 font-medium">What keeps happening</th>
                    <th className="p-2 text-right font-medium print:hidden">Action</th>
                  </tr>
                </thead>
                {DECKS.map((deck) => {
                  const deckRows = visible.filter((r) => r.verdict === deck.verdict);
                  if (deckRows.length === 0) return null;
                  // Onze linhas de "uma falha" enterram as sete que precisam de resposta,
                  // por isso esse bloco abre fechado. Fechado no ecrã, não no papel: um
                  // relatório impresso que esconde linhas é um relatório que mente sobre
                  // o seu próprio total, e o rodapé conta-as todas.
                  const open = openDecks[deck.verdict] !== false;
                  return (
                    <tbody key={deck.verdict} className="break-inside-avoid">
                      <tr>
                        <td colSpan={8} className="px-2 pb-1.5 pt-5">
                          <button
                            type="button"
                            aria-expanded={open}
                            className="flex w-full items-start gap-2 text-left print:cursor-auto"
                            onClick={() => setOpenDecks((o) => ({ ...o, [deck.verdict]: !open }))}
                          >
                            {open
                              ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground print:hidden" />
                              : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground print:hidden" />}
                            <span className="min-w-0">
                              <span className={cn("text-sm font-semibold", TONE_TEXT[deck.tone])}>
                                {deck.title}
                              </span>
                              <span className="ml-2 font-figure text-2xs text-muted-foreground">
                                {deckRows.length}
                              </span>
                              <span className="mt-0.5 block max-w-[70ch] text-2xs font-normal leading-relaxed text-muted-foreground">
                                {deck.blurb}
                              </span>
                            </span>
                          </button>
                        </td>
                      </tr>
                      {deckRows.map((r) => (
                        <AssetRow
                          key={r.asset}
                          row={r}
                          hiddenOnScreen={!open}
                          canManage={canManage}
                          busy={busyAsset === r.asset}
                          onApply={(days) => applyInterval(r, days)}
                          onPlan={() => setPlanFor(r)}
                        />
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </CardContent>
          </Card>
        )}

        <div className="print-doc-footer mt-4 hidden items-center justify-between border-t border-black pt-2 text-[8pt] print:flex">
          <span>
            {rows.length} asset{rows.length === 1 ? "" : "s"} · {ACTIONABLE.reduce((n, v) => n + (counts[v] ?? 0), 0)} needing a decision · {reportPeriodLabel(period, "dd/MM/yyyy")}
          </span>
          <span>Applied Nutrition · Confidential</span>
        </div>

        {planFor && (
          <CreatePlanDialog
            row={planFor}
            pending={createPm.isPending}
            onClose={() => setPlanFor(null)}
            onCreate={async (payload) => {
              try {
                await createPm.mutateAsync(payload);
                toast.success(`${payload.machine} is now scheduled every ${payload.interval_days} days`);
                setPlanFor(null);
              } catch (e) {
                toast.error((e as Error).message || "Could not create the schedule");
              }
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

/** O número recomendado, ou a razão de não haver número. Nunca um piso disfarçado. */
function RecommendedCell({ row }: { row: PmAssetRow }) {
  if (row.verdict === "aggregate") {
    return <span className="text-2xs text-muted-foreground">not per line</span>;
  }
  switch (row.recommendation.kind) {
    case "interval":
      return <span className="font-figure font-semibold">{row.recommendation.days}d</span>;
    case "capped":
      return (
        <span
          className="font-figure font-semibold"
          title={`${row.recommendation.uncapped} days measured — capped at the ${row.recommendation.days}-day ceiling`}
        >
          {row.recommendation.days}d<span className="ml-0.5 font-sans text-2xs font-normal text-muted-foreground">max</span>
        </span>
      );
    case "chronic":
      return (
        <span className="text-2xs text-destructive-strong" title={`${MTBF_FRACTION * 100}% of MTBF is ${row.recommendation.wouldBe} days — below the ${PM_FLOOR_DAYS}-day floor`}>
          none holds
        </span>
      );
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

function AssetRow({
  row, canManage, busy, hiddenOnScreen, onApply, onPlan,
}: {
  row: PmAssetRow;
  canManage: boolean;
  busy: boolean;
  /** Fechado no ecrã, presente no papel. */
  hiddenOnScreen?: boolean;
  onApply: (days: number) => void;
  onPlan: () => void;
}) {
  const days = row.recommendation.kind === "interval" || row.recommendation.kind === "capped"
    ? row.recommendation.days
    : null;

  return (
    <tr className={cn("border-b align-top last:border-0", hiddenOnScreen && "hidden print:table-row")}>
      <td className="p-2 font-medium">
        <span className="flex flex-wrap items-center gap-1.5">
          {row.asset}
          {/* Um nome que não está nem em `machines` nem em `lines`. A ordem foi escrita
              à mão, e nada disto se liga ao registo de activos — quem lê deve saber. */}
          {row.kind === "unknown" && (
            <Badge variant="outline" className="text-[9px] font-normal leading-4 text-muted-foreground" title="Not in the machine or line register">
              unregistered
            </Badge>
          )}
        </span>
      </td>
      <td className="p-2 text-right font-figure">{row.failures}</td>
      <td className="p-2 text-right font-figure">
        {row.mtbfDays !== null ? `${row.mtbfDays.toFixed(1)}d` : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="p-2 text-right font-figure">
        {row.mttrHours !== null
          ? <span title={`Average of ${row.repairSample} timed repair${row.repairSample === 1 ? "" : "s"}`}>{row.mttrHours.toFixed(1)}h</span>
          : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="p-2 text-right font-figure">
        {row.currentInterval !== null
          ? `${row.currentInterval}d`
          : <span className="font-sans text-2xs text-muted-foreground">no plan</span>}
      </td>
      <td className="p-2 text-right"><RecommendedCell row={row} /></td>
      <td className="p-2 text-xs text-muted-foreground">
        {row.topIssues.length === 0 ? "—" : (
          <ul className="space-y-0.5">
            {row.topIssues.map((i, idx) => (
              <li key={idx} className="max-w-[280px] truncate">
                <span className="mr-1 font-figure font-semibold">{i.count}×</span>
                {i.description}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="p-2 text-right print:hidden">
        {!canManage ? (
          <span className="text-2xs text-muted-foreground">view only</span>
        ) : row.verdict === "adjust" && days !== null ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onApply(days)}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Set to {days}d
          </Button>
        ) : row.verdict === "plan" && days !== null ? (
          /* Era o texto morto "create PM first", nas 23 linhas, porque não há um único
             plano na base. Agora cria-o, com o intervalo que esta página mediu. */
          <Button size="sm" disabled={busy} onClick={onPlan} className="gap-1">
            <CalendarPlus className="h-3.5 w-3.5" /> Create plan
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function CreatePlanDialog({
  row, pending, onClose, onCreate,
}: {
  row: PmAssetRow;
  pending: boolean;
  onClose: () => void;
  onCreate: (payload: { machine: string; title: string; description: string; interval_days: number; priority: string; active: boolean; next_due_at: string }) => void;
}) {
  const suggested = row.recommendation.kind === "interval" || row.recommendation.kind === "capped"
    ? row.recommendation.days
    : PM_FLOOR_DAYS;
  const [title, setTitle] = useState(`Preventive service — ${row.asset}`);
  const [intervalDays, setIntervalDays] = useState(suggested);
  const [description, setDescription] = useState(
    row.topIssues.length
      ? `Recurring in the period:\n${row.topIssues.map((i) => `· ${i.count}× ${i.description}`).join("\n")}`
      : "",
  );

  const valid = title.trim().length > 0 && Number.isFinite(intervalDays) && intervalDays >= 1;
  const firstDue = new Date(Date.now() + Math.max(intervalDays || 1, 1) * 86_400_000);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5" /> Schedule {row.asset}
          </DialogTitle>
          <DialogDescription>
            {row.failures} failures in the period give an MTBF of {row.mtbfDays?.toFixed(1)} days.
            Servicing at {Math.round(MTBF_FRACTION * 100)}% of that puts the work before the average
            failure rather than after it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Every (days)</Label>
              <Input
                type="number" min={1}
                className="font-figure"
                value={Number.isFinite(intervalDays) ? intervalDays : ""}
                onChange={(e) => setIntervalDays(parseInt(e.target.value || "0", 10))}
              />
              {intervalDays !== suggested && (
                <p className="mt-1 text-2xs text-muted-foreground">Measured: {suggested}d</p>
              )}
            </div>
            <div>
              <Label className="text-xs">First due</Label>
              <Input disabled className="font-figure" value={format(firstDue, "dd/MM/yyyy")} />
            </div>
          </div>
          <div>
            <Label className="text-xs">What the record shows</Label>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={pending || !valid}
            onClick={() =>
              onCreate({
                machine: row.asset,
                title: title.trim(),
                description,
                interval_days: intervalDays,
                priority: row.failures >= 10 ? "high" : "medium",
                active: true,
                next_due_at: firstDue.toISOString(),
              })
            }
          >
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
