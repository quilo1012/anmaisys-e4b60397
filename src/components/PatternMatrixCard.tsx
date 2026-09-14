/**
 * A matriz de padrões — linhas × (dia da semana, turno) — num sítio só.
 *
 * Nasceu dentro do `HeatmapSection` da página de Downtime. Quando o armazém
 * quis a mesma tabela, a escolha era copiar 130 linhas de marcação ou levantá-la
 * daqui: o mesmo erro que o comentário do `computeHeatmap` já descreve, duas
 * fontes para uma tabela e só uma delas é que alguém se lembraria de corrigir.
 *
 * A agregação continua a ser o `computeHeatmap`; isto é só a tabela.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DAYS, SHIFTS, londonAllParts, type Cell, type HeatmapResult, type Shift } from "@/lib/downtimeHeatmap";
import { isMostlyUnresumed } from "@/lib/downtimeAttribution";
import { formatMinutes } from "@/lib/formatDuration";
import type { ReactNode } from "react";
import { useMemo } from "react";

function cellColor(minutes: number, max: number): string {
  if (minutes <= 0) return "bg-background";
  const pct = max > 0 ? minutes / max : 0;
  if (pct < 0.15) return "bg-success/15 text-success-strong";
  if (pct < 0.35) return "bg-warning/20/25 text-warning-strong";
  if (pct < 0.65) return "bg-warning/40 text-warning-strong";
  return "bg-destructive/70 text-destructive-foreground";
}

const EMPTY_CELL: Cell = { minutes: 0, count: 0, systemMinutes: 0 };

/**
 * A data de calendário (dd/MM) por baixo de cada coluna — só quando o intervalo
 * apanha aquele dia da semana exactamente uma vez, ou seja, numa semana só.
 */
function useWeekdayDates(fromMs: number, toMs: number): (string | null)[] {
  return useMemo(() => {
    const byIdx = new Map<number, Set<string>>();
    const startP = londonAllParts(new Date(fromMs));
    const endP = londonAllParts(new Date(toMs));
    const endNum = endP.year * 10000 + endP.month * 100 + endP.day;
    let y = startP.year, mo = startP.month, d = startP.day;
    for (let guard = 0; guard < 400; guard++) {
      const cur = new Date(Date.UTC(y, mo - 1, d));
      const cy = cur.getUTCFullYear(), cmo = cur.getUTCMonth() + 1, cd = cur.getUTCDate();
      if (cy * 10000 + cmo * 100 + cd > endNum) break;
      const dayIdx = (cur.getUTCDay() + 6) % 7;
      const label = `${String(cd).padStart(2, "0")}/${String(cmo).padStart(2, "0")}`;
      const s = byIdx.get(dayIdx) ?? new Set<string>(); s.add(label); byIdx.set(dayIdx, s);
      const next = new Date(Date.UTC(cy, cmo - 1, cd + 1));
      y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate();
    }
    const out: (string | null)[] = [];
    for (let i = 0; i < 7; i++) { const s = byIdx.get(i); out[i] = s && s.size === 1 ? [...s][0] : null; }
    return out;
  }, [fromMs, toMs]);
}

export interface PatternMatrixCardProps {
  title: ReactNode;
  description: ReactNode;
  heatmap: HeatmapResult;
  fromMs: number;
  toMs: number;
  shiftFilter: "all" | Shift;
  /** Cabeçalho da primeira coluna. */
  rowHeader?: string;
  /** O que escrever na fila que ficou sem nome. */
  emptyRowLabel?: string;
  /** A frase da tabela vazia. */
  emptyMessage?: string;
  /**
   * Marcar com † as células que são sobretudo tempo que ninguém retomou.
   *
   * Faz sentido na manutenção, onde o fecho de turno carimba 06:00 em cada ordem
   * ainda aberta. Não faz no armazém: lá quem fecha é o poll, no minuto em que a
   * linha voltou a andar, e isso é uma medição.
   */
  showUnresumed?: boolean;
  /** Como se chama uma ocorrência, no tooltip da célula. */
  countNoun?: string;
  /**
   * Como se escreve uma duração numa célula.
   *
   * A manutenção usa "Xh Ym" porque as suas paragens contam-se em horas. O
   * armazém não: as esperas ficam quase todas abaixo da hora, e catorze colunas
   * de "0h 12m" são o ruído que o `formatDurationCompact` existe para evitar.
   */
  formatCell?: (minutes: number) => string;
  /** O que a legenda diz sobre o †. */
  unresumedLegend?: string;
  /** A frase que o tooltip acrescenta quando a célula tem minutos marcados. */
  unresumedNote?: (formatted: string) => string;
  /** Rodapé, por baixo da tabela. */
  footer?: ReactNode;
}

export function PatternMatrixCard({
  title,
  description,
  heatmap,
  fromMs,
  toMs,
  shiftFilter,
  rowHeader = "Line",
  emptyRowLabel = "(line removed)",
  emptyMessage = "No downtime recorded in the selected range.",
  showUnresumed = true,
  countNoun = "events",
  formatCell = formatMinutes,
  unresumedLegend = "† auto-closed",
  unresumedNote = (t) => ` — ${t} of it auto-closed at a shift boundary, not resumed by anyone`,
  footer,
}: PatternMatrixCardProps) {
  const { matrix, lines, lineTotals, dayShiftTotals, grandMax, grandTotalMinutes } = heatmap;
  const dayDates = useWeekdayDates(fromMs, toMs);
  const visibleShifts = (shiftFilter === "all" ? SHIFTS : [shiftFilter]) as readonly Shift[];
  const dagger = (cell: Cell | undefined) =>
    showUnresumed && isMostlyUnresumed(cell)
      ? <span className="ml-0.5 align-super text-2xs opacity-70">†</span>
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-muted-foreground">
            <span>Less</span>
            <span className="h-3 w-5 rounded-sm bg-success/15 ring-1 ring-inset ring-border" />
            <span className="h-3 w-5 rounded-sm bg-warning/20/25" />
            <span className="h-3 w-5 rounded-sm bg-warning/40" />
            <span className="h-3 w-5 rounded-sm bg-destructive/70" />
            <span>More</span>
            {showUnresumed && (
              <span className="ml-2 border-l border-border pl-2 normal-case tracking-normal">{unresumedLegend}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-1 min-w-[820px]">
          <thead>
            <tr>
              <th className="text-left p-2 sticky left-0 bg-card z-10">{rowHeader}</th>
              {DAYS.map((d, di) => (
                <th key={d} colSpan={visibleShifts.length} className="text-center px-1 pt-1 pb-0 border-b border-border/60">
                  <div className="font-semibold text-foreground">{d}</div>
                  <div className="text-2xs font-normal text-muted-foreground tabular-nums h-3">{dayDates[di] ?? ""}</div>
                </th>
              ))}
              <th className="text-right p-2">Total</th>
            </tr>
            <tr className="text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 bg-card z-10" />
              {DAYS.flatMap((d) => visibleShifts.map((s) => (
                <th key={`${d}-${s}`} className="font-medium pb-1">{s[0]}</th>
              )))}
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={2 + DAYS.length * visibleShifts.length} className="p-8 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {lines.map((line) => {
              const lm = matrix.get(line)!;
              const total = lineTotals.get(line)?.minutes ?? 0;
              return (
                <tr key={line}>
                  <td className="p-2 font-medium sticky left-0 bg-card z-10 border-r border-border/60 whitespace-nowrap">
                    {line === "—" ? <span className="italic text-muted-foreground">{emptyRowLabel}</span> : line}
                  </td>
                  {DAYS.map((_, di) =>
                    visibleShifts.map((s) => {
                      const c = lm.get(`${di}-${s}`) ?? EMPTY_CELL;
                      const hasData = c.minutes > 0;
                      return (
                        <td
                          key={`${line}-${di}-${s}`}
                          className={`text-center rounded-md ${hasData ? cellColor(c.minutes, grandMax) : "bg-muted/20"}`}
                          title={
                            `${line} • ${DAYS[di]} ${s}: ${formatCell(c.minutes)} (${c.count} ${countNoun})` +
                            (showUnresumed && c.systemMinutes > 0 ? unresumedNote(formatCell(c.systemMinutes)) : "")
                          }
                        >
                          <div className="px-1 py-1.5 leading-tight">
                            <div className="font-semibold tabular-nums">
                              {hasData ? formatCell(c.minutes) : <span className="text-muted-foreground/40">—</span>}
                              {dagger(c)}
                            </div>
                            {c.count > 0 && <div className="text-2xs opacity-80 tabular-nums">{c.count}×</div>}
                          </div>
                        </td>
                      );
                    }),
                  )}
                  <td className="p-2 text-right font-semibold tabular-nums border-l border-border/60">
                    {formatCell(total)}
                    {dagger(lineTotals.get(line))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t">
                <td className="p-2 font-semibold sticky left-0 bg-card">Totals</td>
                {DAYS.map((_, di) =>
                  visibleShifts.map((s) => {
                    const c = dayShiftTotals.get(`${di}-${s}`) ?? EMPTY_CELL;
                    return (
                      <td key={`tot-${di}-${s}`} className="text-center p-1 font-semibold tabular-nums text-muted-foreground">
                        {c.minutes > 0 ? formatCell(c.minutes) : "—"}
                        {dagger(c)}
                      </td>
                    );
                  }),
                )}
                <td className="p-2 text-right font-bold tabular-nums border-l border-border/60">
                  {grandTotalMinutes > 0 ? formatCell(grandTotalMinutes) : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        {footer}
      </CardContent>
    </Card>
  );
}
