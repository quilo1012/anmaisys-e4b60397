/**
 * A vida de uma espera do armazém, que tem três batidas e não oito.
 *
 * O `WoTimeline` conta a história de uma avaria: a linha parou, um engenheiro
 * aceitou, deslocou-se, começou, acabou, a linha voltou, a ordem fechou. Uma
 * ordem de armazém reaproveitava esse cartão e ficava com cinco dessas batidas
 * em "— not yet" para sempre, porque nenhuma delas pode acontecer: ninguém
 * aceita, ninguém se desloca, ninguém repara. E por baixo dizia
 * "Line Downtime 0h 0m" — zero medido, num tipo de ordem cujo contrato inteiro
 * é nunca contar como downtime de linha.
 *
 * O que uma espera tem é isto: a linha pediu embalagem, e a linha voltou a
 * andar. Quem fecha é o poll do iTouching, no ciclo em que vê a máquina mexer;
 * qualquer outro fim foi uma pessoa a arrumar a ordem, e aí o carimbo mede
 * quando alguém reparou nela, não quanto tempo a linha esperou — a mesma
 * ressalva que a matriz marca com †.
 */
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, PackageCheck, AlertTriangle } from "lucide-react";
import { formatWarehouseWait, warehouseWaitMinutes } from "@/lib/warehouseWait";

/** O único estado com que o poll fecha uma espera. Ver `woKinds`/`warehouseHeatmap`. */
const CLOSED_BY_THE_POLL = "closed";

export interface WarehouseWaitOrder {
  created_at: string;
  closed_at?: string | null;
  finished_at?: string | null;
  status?: string | null;
  line_at_time?: string | null;
  requester_name?: string | null;
}

export function WarehouseWaitTimeline({ wo }: { wo: WarehouseWaitOrder }) {
  const endedAt = wo.closed_at ?? wo.finished_at ?? null;
  const pollClosed = (wo.status ?? CLOSED_BY_THE_POLL) === CLOSED_BY_THE_POLL;
  const stillWaiting = !endedAt;
  const minutes = warehouseWaitMinutes(wo);

  const steps = [
    {
      label: "Line asked the warehouse",
      ts: wo.created_at,
      detail: [wo.line_at_time, wo.requester_name].filter(Boolean).join(" · ") || undefined,
      tone: "milestone" as const,
    },
    stillWaiting
      ? { label: "Still waiting", ts: null, detail: "The line has not run again yet.", tone: "open" as const }
      : pollClosed
        ? {
            label: "Line running again",
            ts: endedAt,
            detail: "Closed by the iTouching poll, in the cycle it saw the machine move.",
            tone: "milestone" as const,
          }
        : {
            label: "Order force-closed",
            ts: endedAt,
            detail: "Ended by a person, not by the line starting. The wait below says the line was flagged, not how long it waited.",
            tone: "forced" as const,
          },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Wait Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative border-l border-border ml-3 space-y-4">
          {steps.map((s, i) => (
            <li key={i} className="ml-4">
              <span
                className={`absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full ${
                  s.tone === "forced" ? "bg-warning" : s.ts ? "bg-primary" : "bg-muted"
                }`}
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className={`text-sm font-medium ${s.ts ? "" : "text-muted-foreground"}`}>
                  {s.tone === "forced" && <AlertTriangle className="mr-1 inline h-3 w-3 text-warning-strong" />}
                  {s.tone === "milestone" && i > 0 && <PackageCheck className="mr-1 inline h-3 w-3 text-success-strong" />}
                  {s.label}
                </p>
                <span className="text-xs font-mono text-muted-foreground">
                  {s.ts ? format(new Date(s.ts), "dd/MM HH:mm:ss") : "— not yet"}
                </span>
              </div>
              {s.detail && <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>}
            </li>
          ))}
        </ol>

        <div className="mt-6 grid grid-cols-2 gap-3 pt-4 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Wait</p>
            <p className="text-lg font-bold">
              {formatWarehouseWait(wo)}
              {stillWaiting && <span className="ml-1 text-xs font-normal text-warning-strong">still waiting</span>}
              {!stillWaiting && !pollClosed && (
                <span className="ml-1 align-super text-2xs opacity-70" title="Not closed by the poll">†</span>
              )}
            </p>
            {!stillWaiting && !pollClosed && minutes !== null && (
              <p className="mt-1 text-2xs text-muted-foreground">
                † not closed by the poll — evidence the line was flagged, not a measured wait.
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Line downtime</p>
            {/* Não é "0h 0m". Zero lê-se como uma medição de zero, e isto não é
                uma medição: é uma ordem que, por desenho, nunca entra no
                downtime de produção. */}
            <p className="text-lg font-bold text-muted-foreground">Not counted</p>
            <p className="mt-1 text-2xs text-muted-foreground">
              A warehouse wait never counts as production-line downtime.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
