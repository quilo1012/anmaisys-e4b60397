import { useMemo, useState } from "react";
import { addMonths, format, startOfMonth } from "date-fns";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { buildMonthGrid } from "@/lib/pmCalendar";
import { pmStatus, type PmSchedule } from "@/hooks/usePreventiveMaintenance";
import { statusStyle } from "./pmStatusStyle";

/**
 * O mes de preventiva desenhado, em vez de listado.
 *
 * A lista responde "o que ha para fazer". Quem planeia pergunta outra coisa: em que
 * dia da semana isto cai, que semana ja esta cheia, e onde e que ainda cabe um
 * servico sem parar a linha duas vezes. Uma lista ordenada por data nao responde a
 * nenhuma das tres — a carga de uma terca so se ve contando linhas.
 *
 * Clicar num dia vazio abre o plano novo com essa data ja escolhida, que e o gesto
 * inteiro: ve-se a folga e marca-se ali. Quem nao tem `pm.manage` clica e nada
 * acontece, em vez de levar com um erro de RLS depois de preencher o formulario.
 */

const DIAS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Quantos planos cabem numa celula antes de a lista passar a contagem. */
const POR_CELULA = 3;

interface Props {
  schedules: PmSchedule[];
  canManage: boolean;
  /** Um dia clicado: abre o plano novo ja com esta data de vencimento. */
  onPickDay: (date: Date) => void;
  onPickSchedule: (schedule: PmSchedule) => void;
}

export function PmCalendarMonth({ schedules, canManage, onPickDay, onPickSchedule }: Props) {
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const hoje = useMemo(() => new Date(), []);

  const { weeks, overdueBefore } = useMemo(
    () => buildMonthGrid(anchor, schedules, hoje),
    [anchor, schedules, hoje],
  );

  const noMes = weeks.flat().reduce((n, d) => n + (d.inMonth ? d.items.length : 0), 0);

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8"
          aria-label="Previous month"
          onClick={() => setAnchor((a) => addMonths(a, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8"
          aria-label="Next month"
          onClick={() => setAnchor((a) => addMonths(a, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="font-semibold">{format(anchor, "MMMM yyyy")}</div>
        <span className="text-sm text-muted-foreground">
          {noMes === 0 ? "nothing due this month" : `${noMes} due this month`}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto"
          onClick={() => setAnchor(startOfMonth(new Date()))}>
          Today
        </Button>
      </div>

      {overdueBefore.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 flex flex-wrap items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive-strong shrink-0" />
            <span className="text-destructive-strong font-medium">
              {overdueBefore.length} overdue before this month
            </span>
            <span className="text-muted-foreground">— too old to land on this grid:</span>
            {overdueBefore.slice(0, 6).map((s) => (
              <button key={s.id} type="button"
                onClick={() => onPickSchedule(s)}
                className="rounded border border-destructive/40 bg-destructive/15 px-2 py-0.5 text-destructive-strong hover:bg-destructive/25">
                {s.machine} · {s.title}
              </button>
            ))}
            {overdueBefore.length > 6 && (
              <span className="text-muted-foreground">+{overdueBefore.length - 6} more</span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className="grid grid-cols-7 border-b border-border">
            {DIAS.map((d) => (
              <div key={d} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {weeks.flat().map((dia) => {
              const extra = dia.items.length - POR_CELULA;
              return (
                <div
                  key={dia.date.toISOString()}
                  className={cn(
                    "group relative min-h-[6.5rem] border-b border-r border-border p-1.5 text-left align-top",
                    !dia.inMonth && "bg-muted/40",
                    canManage && "cursor-pointer hover:bg-accent/40",
                  )}
                  onClick={() => canManage && onPickDay(dia.date)}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-figure",
                      dia.isToday && "bg-primary text-primary-foreground font-semibold",
                      !dia.isToday && !dia.inMonth && "text-muted-foreground",
                    )}>
                      {dia.date.getDate()}
                    </span>
                    {canManage && (
                      <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    )}
                  </div>

                  <div className="mt-1 space-y-1">
                    {dia.items.slice(0, POR_CELULA).map((s) => {
                      const estado = pmStatus(s, hoje);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          title={`${s.machine} — ${s.title} (every ${s.interval_days}d)`}
                          onClick={(e) => { e.stopPropagation(); onPickSchedule(s); }}
                          className={cn(
                            "block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight",
                            statusStyle[estado].chip,
                          )}
                        >
                          <span className="font-medium">{s.machine}</span> {s.title}
                        </button>
                      );
                    })}
                    {extra > 0 && (
                      <div className="px-1.5 text-[11px] text-muted-foreground">+{extra} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
