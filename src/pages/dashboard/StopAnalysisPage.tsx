import { PageHeader } from "@/components/ui/PageHeader";
import { useState, useMemo, useEffect, useRef } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Figure, FigureRow } from "@/components/ui/Figure";
import { EmptyState } from "@/components/EmptyState";
import { DateRangeFilter, type DateRangePreset, getPresetRange } from "@/components/DateRangeFilter";
import { ShiftFilter as ShiftPills, type ShiftValue } from "@/components/ShiftFilter";
import { useOpsShift } from "@/hooks/useOpsFilters";
import { resolveReportRange } from "@/lib/reportRange";
import { useProductionStops } from "@/hooks/useProductionStops";
import { useLines } from "@/hooks/useMachines";
import { getCurrentFactoryShift, rowMatchesShift } from "@/lib/shifts";
import { currentShift } from "@/lib/operationalShift";
import { formatMinutes } from "@/lib/formatDuration";
import { cn } from "@/lib/utils";
import {
  classifyStopReason,
  totalsByBucket,
  totalsByReason,
  averagePerLine,
  lineReasonMatrix,
  BUCKET_LABEL,
  BUCKET_HINT,
  type StopBucket,
  type ProductionStop,
} from "@/lib/stopAnalysis";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { AlertTriangle, Timer } from "lucide-react";

/**
 * Para onde vão as horas em que a linha não anda.
 *
 * A fábrica regista cerca de 6 700 paragens por mês, cada uma com o seu motivo, e até
 * este ecrã existir ninguém as via: o único sítio onde o downtime aparecia era a
 * coluna DT da grelha RAG, escrita à mão — 35 números por mês contra 6 700 registos.
 *
 * O ecrã responde a uma pergunta e mais nenhuma. Setembro de 2026 deu 2 638 horas
 * paradas, e **as avarias foram 4%**. O resto foi preparação de linha, enchimento de
 * blender, limpeza e espera por aprovações. Todo o módulo de manutenção desta app —
 * ordens, PINs, MTTR, peças — aponta aos 4%; os outros 96% não tinham ecrã nenhum.
 *
 * DUAS DECISÕES QUE MOLDAM O QUE SE VÊ.
 *
 * O planeado está fora por omissão. Pausas e turnos não planeados são o calendário,
 * não uma perda, e deixá-los dentro diluía tudo o resto — "No Planned Shift" sozinho
 * levava 34% e empurrava a preparação de linha para metade do tamanho real. O
 * interruptor existe e diz o que faz.
 *
 * A média por ocorrência está ao lado do total, e não em vez dele. São duas perguntas:
 * o total diz quem pára mais horas, a média diz quem é mais lento de cada vez. Uma
 * linha com o dobro das mudanças de SKU pára mais sem ser pior a fazê-las — e é a
 * média, não o total, que aponta para quem tem o método que vale a pena copiar.
 *
 * ABRE NO TURNO A DECORRER, NÃO EM TRINTA DIAS.
 *
 * O ecrã abria em trinta dias e "ALL shifts". Quem o abre a meio de um turno quer
 * saber o que está a acontecer agora, e o motivo maior de um mês inteiro não é o
 * motivo maior deste turno — mas o número grande no topo tem o mesmo aspecto nos dois
 * casos, e quem o lê não tem como saber a diferença. Agora abre no turno a decorrer,
 * e alargar está a um clique.
 *
 * O período por omissão é o preset `shift` do DateRangeFilter, que já existia e já é
 * calculado com getCurrentFactoryShift + londonWallToUtc.
 *
 * O QUE TORNA ISTO CORRECTO, E NÃO SÓ MAIS ESTREITO.
 *
 * `production_downtimes.occurred_date` é a data OPERACIONAL, não a do relógio: uma
 * paragem às 02:00 pertence à noite do dia anterior e é assim que está gravada. Está
 * verificado contra `started_at` — 2 857 registos entre a meia-noite e as 06:00, todos
 * datados com o dia anterior, zero excepções. `getCurrentFactoryShift()` recua o dia
 * exactamente da mesma maneira, por isso os dois concordam sem precisar de ajuste
 * nenhum. Acrescentar aqui um recuo "por segurança" aplicava-o duas vezes e mostrava
 * a noite errada.
 *
 * O turno sai da coluna `shift` via `rowMatchesShift`, nunca do relógio. Uma paragem
 * da noite lançada às 07:00 responde DAY ao relógio e NIGHT à coluna, e a coluna é a
 * que uma pessoa preencheu.
 *
 * O selector de linha continua a ser o de sempre, com "All lines". O operador não
 * chega aqui: `stopanalysis.view` não lhe é concedido pela MATRIX em
 * `src/lib/permissions.ts`, e há ainda uma linha em `role_permission_overrides` a
 * negá-lo — posta a 03/10/2026, quando o código ainda concedia. As duas dizem agora
 * o mesmo; o override fica como rede, porque é ele que vale em produção enquanto
 * este código não for publicado.
 *
 * Nenhuma das outras contas está ligada a uma linha, por isso não há "a minha linha"
 * para fixar.
 */

const BUCKET_COLOR: Record<StopBucket, string> = {
  process: "hsl(var(--warning))",
  fault: "hsl(var(--destructive))",
  planned: "hsl(var(--muted-foreground))",
  // Nunca chega a desenhar-se: o `unscheduled` sai do conjunto analisado antes de
  // qualquer gráfico. Está aqui porque o Record exige todas as chaves, e porque uma
  // cor em falta é um crash e não um buraco.
  unscheduled: "hsl(var(--muted-foreground))",
  unknown: "hsl(var(--primary))",
};

const BUCKET_BADGE: Record<StopBucket, string> = {
  process: "bg-warning/15 text-warning-strong border-warning/30",
  fault: "bg-destructive/15 text-destructive-strong border-destructive/30",
  planned: "bg-muted text-muted-foreground border-border",
  unscheduled: "bg-muted text-muted-foreground border-border",
  unknown: "bg-primary/10 text-primary border-primary/30",
};

/** Minutos → horas, para os eixos dos gráficos, onde "1h 25m" não cabe. */
const hours = (min: number) => Math.round((min / 60) * 10) / 10;

export default function StopAnalysisPage() {
  // Abre no turno a decorrer. O preset `shift` já traz a madrugada agarrada à noite
  // do dia anterior, tal como o occurred_date faz na base de dados.
  const initial = getPresetRange("shift");
  const [startDate, setStartDate] = useState<Date>(initial.from ?? new Date());
  const [endDate, setEndDate] = useState<Date>(initial.to ?? new Date());
  const [datePreset, setDatePreset] = useState<DateRangePreset>("shift");
  const [filterLine, setFilterLine] = useState("all");
  const [opsShift, setOpsShift] = useOpsShift();
  // O planeado fora por omissão — ver a nota no topo do ficheiro.
  const [includePlanned, setIncludePlanned] = useState(false);

  const { data, isLoading } = useProductionStops(startDate, endDate);
  const { data: lines = [] } = useLines();

  /**
   * O turno a decorrer, uma vez, à entrada.
   *
   * Escreve na chave partilhada `ops:shift`, de propósito: o valor viaja para o
   * Downtime e para as Ordens, e dois ecrãs abertos lado a lado com turnos diferentes
   * é precisamente o que essa chave existe para evitar. A partir daqui, o que o
   * utilizador escolher nas pastilhas manda.
   */
  const shiftDefaulted = useRef(false);
  useEffect(() => {
    if (shiftDefaulted.current) return;
    shiftDefaulted.current = true;
    setOpsShift(getCurrentFactoryShift().shiftCode === "night" ? "NIGHT" : "DAY");
  }, [setOpsShift]);

  const lineOptions = useMemo(
    () => [...new Set(lines.map((l) => l.name))].sort(),
    [lines],
  );

  /** Depois dos filtros de linha e turno, mas ainda com o planeado lá dentro. */
  const scoped = useMemo<ProductionStop[]>(() => {
    const all = data?.stops ?? [];
    return all.filter((s) => {
      if (filterLine !== "all" && s.line !== filterLine) return false;
      // Pela coluna, não pelo relógio — ver a nota no topo do ficheiro.
      if (!rowMatchesShift(s.shift, opsShift as ShiftValue)) return false;
      return true;
    });
  }, [data, filterLine, opsShift]);

  /**
   * O conjunto que o ecrã analisa.
   *
   * O `unscheduled` sai SEMPRE, e não tem interruptor: uma linha que não foi escalada
   * não parou, nunca arrancou. Enquanto contou como paragem valia 30,6% de todos os
   * minutos e empurrava para baixo a percentagem de tudo o que é mesmo uma paragem.
   * O planeado sai também, mas esse volta se o pedirem.
   */
  const stops = useMemo(
    () =>
      scoped.filter((s) => {
        const b = classifyStopReason(s.reason);
        if (b === "unscheduled") return false;
        return includePlanned || b !== "planned";
      }),
    [scoped, includePlanned],
  );

  const buckets = useMemo(() => totalsByBucket(scoped), [scoped]);
  const reasons = useMemo(() => totalsByReason(stops), [stops]);
  const totalMinutes = useMemo(() => reasons.reduce((a, r) => a + r.minutes, 0), [reasons]);
  const plannedMinutes = useMemo(
    () => buckets.find((b) => b.bucket === "planned")?.minutes ?? 0,
    [buckets],
  );
  const unscheduled = useMemo(
    () => buckets.find((b) => b.bucket === "unscheduled"),
    [buckets],
  );
  const unknown = useMemo(() => reasons.filter((r) => r.bucket === "unknown"), [reasons]);

  /** O motivo maior, e quem é mais lento a fazê-lo. É a conclusão do ecrã. */
  const topReason = reasons[0]?.key ?? null;
  const topReasonByLine = useMemo(
    () => (topReason ? averagePerLine(stops, topReason) : []),
    [stops, topReason],
  );

  const matrix = useMemo(() => lineReasonMatrix(stops, 6), [stops]);

  const reasonChart = useMemo(
    () => reasons.slice(0, 10).map((r) => ({ name: r.key, hours: hours(r.minutes), bucket: r.bucket, count: r.count })),
    [reasons],
  );

  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000));

  /**
   * O que se está a ver, dito por extenso.
   *
   * O `carriedOver` é o que impede o telefonema das duas da manhã: entre a meia-noite
   * e as 06:00 o ecrã mostra a data de ONTEM, correctamente, e sem uma frase a
   * dizê-lo isso lê-se como avaria.
   */
  const op = currentShift();
  const where = filterLine === "all" ? "all lines" : filterLine;
  const when = opsShift === "ALL" ? "all shifts" : opsShift === "DAY" ? "day shift" : "night shift";
  const isNarrowed = datePreset === "shift" || opsShift !== "ALL" || filterLine !== "all";

  const widen = () => {
    const r = getPresetRange("30d");
    setStartDate(r.from ?? new Date());
    setEndDate(r.to ?? new Date());
    setDatePreset("30d");
    setOpsShift("ALL");
    setFilterLine("all");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          module="Production"
          title="Stop Analysis"
          description="Where the hours go when the line is not running"
          icon={<Timer className="h-5 w-5" />}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* Sem storageKey, de propósito: o efeito de restauro do DateRangeFilter
                  corre ao montar e sobrepunha-se ao preset `shift` sempre que houvesse
                  um período guardado de outra visita, o que tornava o período de
                  abertura dependente do que estivesse em localStorage. O turno
                  continua partilhado por `ops:shift`; só o período deixa de ser. */}
              <DateRangeFilter
                value={{ from: startDate, to: endDate }}
                preset={datePreset}
                onChange={(range, preset) => {
                  setDatePreset(preset);
                  const resolved = resolveReportRange(range);
                  const r = preset === "all" ? { from: resolved.startDate, to: resolved.endDate } : range;
                  if (r.from) setStartDate(r.from);
                  setEndDate(r.to ?? new Date());
                }}
              />
              <Select value={filterLine} onValueChange={setFilterLine}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Line" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All lines</SelectItem>
                  {lineOptions.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              <ShiftPills value={opsShift} onChange={setOpsShift} />
            </div>
          }
        />

        {/* O âmbito, antes dos números. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{where}</strong>,{" "}
            <strong className="text-foreground">{when}</strong>
            {datePreset === "shift" && (
              <>
                , {op.operationalDate}
                {op.carriedOver && <> — the night that started yesterday evening and is still running</>}
              </>
            )}
            .
          </span>
          {isNarrowed && (
            <Button variant="link" className="h-auto p-0 text-sm" onClick={widen}>
              Show all lines and shifts, last 30 days
            </Button>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-96" />
        ) : scoped.length === 0 ? (
          <EmptyState
            icon={Timer}
            title={`No stoppages on ${where} for the ${when}`}
            description={
              `A shift with no stoppages is a real result, not a missing one — ${
                datePreset === "shift" ? `this is ${op.operationalDate}` : "this is the period you chose"
              }. Widen the period or the shift to compare it with the days around it. ` +
              `If a line never shows stoppages, whatever the period, then it is not mapped — check System → iTouching Machines.`
            }
          />
        ) : (
          <>
            {data?.truncated && (
              <Card className="border-warning/40 bg-warning/[0.06]">
                <CardContent className="flex items-start gap-2 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" aria-hidden="true" />
                  <span>
                    This period has more stoppages than one query returns, so the figures below
                    are a part and not the whole. Narrow the period to read them as a total.
                  </span>
                </CardContent>
              </Card>
            )}

            {/* A resposta do ecrã, e o que a compõe. */}
            <FigureRow>
              <Figure
                lead
                label={includePlanned ? "Hours stopped" : "Hours lost"}
                value={formatMinutes(totalMinutes)}
                hint={`${reasons.reduce((a, r) => a + r.count, 0).toLocaleString("en-US")} stoppages over ${days} day${days === 1 ? "" : "s"}`}
                tone="owed"
              />
              {buckets
                .filter((b) => b.bucket !== "unscheduled")
                .filter((b) => includePlanned || b.bucket !== "planned")
                .map((b) => (
                  <Figure
                    key={b.bucket}
                    label={BUCKET_LABEL[b.bucket]}
                    value={formatMinutes(b.minutes)}
                    hint={`${b.pct}% of all stopped time · ${b.count.toLocaleString("en-US")} stops`}
                  />
                ))}
            </FigureRow>

            {/*
              O tempo que a linha não tinha para dar.
              Fora da linha dos cartões de propósito: aquela soma o tempo parado, e isto
              não é tempo parado. Tem cartão próprio para a capacidade por usar não
              desaparecer do ecrã só por ter saído da conta.
            */}
            {unscheduled && unscheduled.minutes > 0 && (
              <FigureRow>
                <Figure
                  label={BUCKET_LABEL.unscheduled}
                  value={formatMinutes(unscheduled.minutes)}
                  hint={`${unscheduled.count.toLocaleString("en-US")} shift${unscheduled.count === 1 ? "" : "s"} the line was never rostered for — spare capacity, not stopped time. Left out of every figure above.`}
                />
              </FigureRow>
            )}

            {/* O interruptor do planeado, dito por extenso em vez de um rótulo mudo. */}
            {plannedMinutes > 0 && (
              <button
                type="button"
                onClick={() => setIncludePlanned((v) => !v)}
                className="flex w-full items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-muted-foreground">
                  {includePlanned ? (
                    <>
                      Planned time is <strong className="text-foreground">included</strong> —{" "}
                      {formatMinutes(plannedMinutes)} of breaks and shift changes.
                      That is the calendar, not a loss. <span className="underline">Leave it out</span>.
                    </>
                  ) : (
                    <>
                      {formatMinutes(plannedMinutes)} of planned time (breaks and shift
                      changes) is <strong className="text-foreground">left out</strong> of
                      the figures above. <span className="underline">Include it</span>.
                    </>
                  )}
                </span>
              </button>
            )}

            {unknown.length > 0 && (
              <Card className="border-primary/30 bg-primary/[0.04]">
                <CardContent className="p-3 text-sm">
                  <span className="font-medium">
                    {unknown.length} reason{unknown.length === 1 ? "" : "s"} not yet classified
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({unknown.map((u) => u.key).join(", ")}) — {formatMinutes(unknown.reduce((a, u) => a + u.minutes, 0))}.
                    They count in the total but belong to no bucket, so the percentages above
                    understate whichever bucket they should be in.
                  </span>
                </CardContent>
              </Card>
            )}

            {/* Onde vão as horas. */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Where the hours go</CardTitle>
                <CardDescription>
                  Top {reasonChart.length} reasons{includePlanned ? "" : ", planned time excluded"}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reasonChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" unit="h" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: number, _n, item) => [
                        `${v}h · ${(item?.payload?.count ?? 0).toLocaleString("en-US")} stops`,
                        BUCKET_LABEL[(item?.payload?.bucket ?? "unknown") as StopBucket],
                      ]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        color: "hsl(var(--popover-foreground))",
                      }}
                      labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                    />
                    <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                      {reasonChart.map((r) => (
                        <Cell key={r.name} fill={BUCKET_COLOR[r.bucket]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Quem é mais lento a fazer a coisa que mais custa. Com uma linha só no
                âmbito este cartão não aparece — uma comparação de um não é uma
                comparação. */}
            {topReason && topReasonByLine.length > 1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {topReason} — how long it takes, line by line
                  </CardTitle>
                  <CardDescription>
                    Average minutes per stoppage, not the total. Lines with fewer than three
                    occurrences are left out — a mean of two is an accident, not a method.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(() => {
                    const worst = topReasonByLine[0];
                    const best = topReasonByLine[topReasonByLine.length - 1];
                    const gap = Math.round(worst.avgMinutes - best.avgMinutes);
                    return (
                      <>
                        {gap > 0 && (
                          <p className="pb-1 text-sm text-muted-foreground">
                            <strong className="text-foreground">{best.line}</strong> does it in{" "}
                            {best.avgMinutes} min on average and{" "}
                            <strong className="text-foreground">{worst.line}</strong> takes{" "}
                            {worst.avgMinutes} — a gap of {gap} minutes, every single time.
                          </p>
                        )}
                        {topReasonByLine.map((l) => {
                          const width = worst.avgMinutes ? (l.avgMinutes / worst.avgMinutes) * 100 : 0;
                          return (
                            <div key={l.line} className="flex items-center gap-3">
                              <span className="w-28 shrink-0 truncate text-sm">{l.line}</span>
                              <div className="h-6 flex-1 rounded bg-muted">
                                <div
                                  className="h-6 rounded bg-warning"
                                  style={{ width: `${Math.max(2, width)}%` }}
                                />
                              </div>
                              <span className="w-32 shrink-0 text-right font-figure text-xs tabular-nums text-muted-foreground">
                                {l.avgMinutes} min · {l.count}×
                              </span>
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* A matriz. É aqui que se vê a linha que destoa — e por isso só faz
                sentido com mais do que uma. */}
            {matrix.lines.length > 1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Line by reason</CardTitle>
                  <CardDescription>Hours stopped. The darker the cell, the more it costs.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="p-2 text-left font-medium">Line</th>
                        {matrix.reasons.map((r) => (
                          <th key={r} className="p-2 text-right text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                            {r}
                          </th>
                        ))}
                        <th className="p-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.lines.map((line) => {
                        const cells = matrix.reasons.map((r) => matrix.cells.get(`${line}|${r}`)?.minutes ?? 0);
                        const rowTotal = cells.reduce((a, c) => a + c, 0);
                        const peak = Math.max(...matrix.reasons.map((r) =>
                          Math.max(...matrix.lines.map((l) => matrix.cells.get(`${l}|${r}`)?.minutes ?? 0)),
                        ), 1);
                        return (
                          <tr key={line} className="border-b last:border-0">
                            <td className="p-2 font-medium">{line}</td>
                            {cells.map((m, i) => (
                              <td
                                key={matrix.reasons[i]}
                                className="p-2 text-right font-figure tabular-nums"
                                style={m > 0 ? { backgroundColor: `hsl(var(--warning) / ${0.08 + (m / peak) * 0.42})` } : undefined}
                              >
                                {m > 0 ? `${hours(m)}h` : <span className="text-muted-foreground">—</span>}
                              </td>
                            ))}
                            <td className="p-2 text-right font-figure font-semibold tabular-nums">{hours(rowTotal)}h</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* A lista completa, para quem quer o número exacto. */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Every reason</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-left font-medium">Reason</th>
                      <th className="p-2 text-left font-medium">Bucket</th>
                      <th className="p-2 text-right font-medium">Stops</th>
                      <th className="p-2 text-right font-medium">Average</th>
                      <th className="p-2 text-right font-medium">Total</th>
                      <th className="p-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reasons.map((r) => (
                      <tr key={r.key} className="border-b last:border-0">
                        <td className="p-2">{r.key}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={cn("text-2xs", BUCKET_BADGE[r.bucket])} title={BUCKET_HINT[r.bucket]}>
                            {BUCKET_LABEL[r.bucket]}
                          </Badge>
                        </td>
                        <td className="p-2 text-right font-figure tabular-nums">{r.count.toLocaleString("en-US")}</td>
                        <td className="p-2 text-right font-figure tabular-nums text-muted-foreground">
                          {Math.round((r.minutes / Math.max(1, r.count)) * 10) / 10} min
                        </td>
                        <td className="p-2 text-right font-figure tabular-nums">{formatMinutes(r.minutes)}</td>
                        <td className="p-2 text-right font-figure tabular-nums">{r.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <p className="text-2xs text-muted-foreground">
              From iTouching, one record per stoppage. Not the same as the stoppages an
              engineer marks on a work order — those are faults only, and the two do not add up.
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
