import { useState } from "react";
import { Figure, FigureRow } from "@/components/ui/Figure";
import { PageHeader } from "@/components/ui/PageHeader";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusRail } from "@/components/ui/StatusRail";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { ShiftFilter } from "@/components/ShiftFilter";
import { useOpsShift, OPS_RANGE_KEY } from "@/hooks/useOpsFilters";
import { useReportSummary } from "@/hooks/useReportSummary";
import { FileBarChart, Gauge, Clock, Wrench, AlertTriangle, ChevronRight, Printer, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BackButton } from "@/components/BackButton";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** `4h 10m`, or `—` when there is nothing to show. */
function mins(n: number): string {
  if (!n) return "—";
  return n < 60 ? `${n}m` : `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, "0")}m`;
}

function Section({
  title, icon: Icon, to, onOpen, children,
}: {
  title: string; icon: LucideIcon; to: string;
  onOpen: (url: string) => void; children: React.ReactNode;
}) {
  return (
    /* A barra saiu.
        Produção verde, Downtime âmbar, Manutenção azul e Qualidade vermelho eram
        quatro cores fixas, sempre acesas, a nomear secções — e três delas são as cores
        com que este sistema diz "em ordem", "atenção" e "parado". Uma secção chamada
        Qualidade não está em vermelho: está a chamar-se Qualidade. O ícone e o título
        já dizem qual é qual.

        Fica assim uma página sem cor nenhuma, e é essa a intenção: neste ecrã a cor
        só aparece quando alguma coisa está mesmo parada — a leitura que falhou, em
        baixo. Um relatório em que tudo está pintado não tem como destacar o dia em
        que não está. */
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
          </div>
          {/* The period travels with you: every screen reads the same stored range,
              so the detail opens on exactly the window summarised here. */}
          <Button variant="ghost" size="sm" className="h-7 text-xs print:hidden" onClick={() => onOpen(to)}>
            Detail <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
          </Button>
        </div>
        {/* Uma resposta por secção, e as outras três ao lado dela.
            Eram dezasseis figuras do mesmo tamanho em quatro grelhas iguais, que é
            exactamente aquilo de que o próprio `Figure` avisa: uma fila de iguais não
            tem resposta nenhuma dentro. Quem abre isto quer saber quanto se produziu,
            quanto tempo se esteve parado, quantas ordens houve e o que ficou por
            fechar — e essas quatro estavam a ser lidas em décimo primeiro lugar. */}
        <FigureRow>{children}</FigureRow>
      </CardContent>
    </Card>
  );
}

/** Quatro secções à espera. O relatório aparece inteiro ou não aparece. */
function SummarySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the period">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="mb-3 h-5 w-32" />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Skeleton className="h-14 flex-[1.6]" />
              <Skeleton className="h-14 flex-1" />
              <Skeleton className="h-14 flex-1" />
              <Skeleton className="h-14 flex-1" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * One period, four areas, one page.
 *
 * Production, downtime, maintenance and quality each had a screen that could export
 * its own corner of the week, and nowhere put them together — so "how did last month
 * go" meant opening four screens and setting four date ranges. This asks the
 * question once.
 *
 * It is a summary, not a fifth source. Every figure comes from the same place its own
 * screen reads, and each section links through to that screen on the same period, so
 * the number here and the number there cannot drift apart.
 *
 * O que não pode acontecer aqui é responder sem saber. A página lia `data!` — uma
 * promessa ao compilador de que os dados estão lá — e vivia de um placeholder de
 * zeros que punha a consulta em "sucesso" ainda antes da primeira leitura voltar. Das
 * duas uma: ou mostrava um relatório de zeros como se fosse a semana, ou, quando a
 * leitura falhava mesmo, a promessa quebrava e a página inteira caía. Agora há três
 * estados e dizem-se pelo nome.
 */
export default function ReportsPage() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<DateRangePreset>("7d");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("7d"));
  const [shift, setShift] = useOpsShift();

  const from = range.from ? iso(range.from) : iso(new Date());
  const to = range.to ? iso(range.to) : from;
  const { data: s, isPending, isError, error, refetch, isFetching } = useReportSummary(from, to, shift);

  const periodLabel = from === to
    ? format(new Date(`${from}T00:00:00`), "EEEE d MMMM yyyy")
    : `${format(new Date(`${from}T00:00:00`), "d MMM")} — ${format(new Date(`${to}T00:00:00`), "d MMM yyyy")}`;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Off the paper: this page prints, and the Print button beside it is already
          dropped by the print stylesheet. */}
      <BackButton className="print:hidden" />

      <PageHeader
        icon={<FileBarChart className="h-5 w-5 text-muted-foreground" />}
        title="Reports"
        description={`${periodLabel}${shift !== "ALL" ? ` · ${shift === "DAY" ? "Day shift" : "Night shift"}` : ""}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            // Nada de imprimir meio relatório: até haver período, não há papel.
            disabled={isPending || isError}
            className="print:hidden"
          >
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <DateRangeFilter
          value={range}
          preset={preset}
          onChange={(r, p) => { setRange(r); setPreset(p); }}
          storageKey={OPS_RANGE_KEY}
        />
        <ShiftFilter value={shift} onChange={setShift} />
      </div>

      {isPending && <SummarySkeleton />}

      {isError && (
        /* O único sítio da página onde entra cor, e entra pela barra do sistema, no
           estado que isto é: parado. Diz que leitura falhou, porque "não foi possível
           carregar" manda o leitor adivinhar entre cinco tabelas — e diz-lhe o que
           pode fazer a seguir. */
        <StatusRail state="stop">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-semibold">The period could not be read</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Nothing is shown for {periodLabel} because one of the reads behind this
                summary failed. Reporting it as zero would say the week was quiet.
              </p>
              <p className="mt-2 break-words rounded-md bg-muted p-2 font-mono text-2xs text-muted-foreground">
                {error instanceof Error ? error.message : String(error)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} className="print:hidden">
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Try again
            </Button>
          </div>
        </StatusRail>
      )}

      {s && (
        <>
          <Section title="Production" icon={Gauge} to="/dashboard/production-performance" onOpen={navigate}>
            {/* A eficiência à frente: é o plano e o feito já comparados, e é a pergunta
                que se faz a um período de produção. Os dois números de que sai ficam
                logo a seguir, para que a conta se possa verificar sem sair daqui. */}
            <Figure bare lead
              label="Efficiency"
              value={s.production.efficiencyPct == null ? "—" : `${s.production.efficiencyPct}%`}
              hint={s.production.efficiencyPct == null ? "no plan recorded" : `${s.production.actual.toLocaleString()} of ${s.production.plan.toLocaleString()}`}
            />
            <Figure bare label="Plan" value={s.production.plan.toLocaleString()} />
            <Figure bare label="Actual" value={s.production.actual.toLocaleString()} />
            <Figure bare label="Days planned" value={String(s.production.days)} />
          </Section>

          <Section title="Downtime" icon={Clock} to="/dashboard/downtime" onOpen={navigate}>
            <Figure bare lead
              label="Total"
              value={mins(s.downtime.minutes)}
              hint={s.downtime.stops ? `across ${s.downtime.stops} ${s.downtime.stops === 1 ? "stoppage" : "stoppages"}` : undefined}
            />
            <Figure bare label="Stoppages" value={String(s.downtime.stops)} />
            <Figure bare
              label="Worst line"
              value={s.downtime.worstLine ?? "—"}
              hint={s.downtime.worstMinutes ? mins(s.downtime.worstMinutes) : undefined}
            />
            <Figure bare
              label="Per stoppage"
              value={s.downtime.stops ? mins(Math.round(s.downtime.minutes / s.downtime.stops)) : "—"}
            />
          </Section>

          <Section title="Maintenance" icon={Wrench} to="/dashboard/work-orders" onOpen={navigate}>
            <Figure bare lead
              label="Raised"
              value={String(s.maintenance.raised)}
              hint={s.maintenance.raised ? `${s.maintenance.closed} closed` : undefined}
            />
            <Figure bare
              label="Closed"
              value={String(s.maintenance.closed)}
              hint={s.maintenance.raised ? `${Math.round((s.maintenance.closed / s.maintenance.raised) * 100)}% of raised` : undefined}
            />
            <Figure bare label="Avg response" value={s.maintenance.avgResponseMin == null ? "—" : `${s.maintenance.avgResponseMin}m`} />
            <Figure bare label="Avg repair" value={s.maintenance.avgRepairMin == null ? "—" : `${s.maintenance.avgRepairMin}m`} />
          </Section>

          <Section title="Quality" icon={AlertTriangle} to="/dashboard/quality" onOpen={navigate}>
            {/* Das quatro de qualidade, a que sobra no fim do período é a que ainda
                está aberta. O total conta o que aconteceu; isto conta o que falta. */}
            <Figure bare lead
              label="Still open"
              value={String(s.quality.open)}
              hint={s.quality.total ? `of ${s.quality.total} raised` : undefined}
            />
            <Figure bare label="Actions" value={String(s.quality.total)} />
            <Figure bare label="Critical" value={String(s.quality.critical)} />
            <Figure bare
              label="Closed"
              value={String(s.quality.total - s.quality.open)}
              hint={s.quality.total ? `${Math.round(((s.quality.total - s.quality.open) / s.quality.total) * 100)}%` : undefined}
            />
          </Section>

          {/* Said plainly, because a summary that hides its own gaps is worse than no
              summary: an empty figure here means nobody recorded it, not that it was
              zero. A frase só pode ser dita ao lado de números que chegaram — por isso
              vive aqui dentro, e não por baixo de um esqueleto ou de uma leitura que
              falhou. */}
          <p className="text-2xs text-muted-foreground">
            A dash means nothing was recorded for that figure in this period — not that it was zero.
            Each section links to the screen it came from, on this same period.
          </p>
        </>
      )}
    </div>
  );
}
