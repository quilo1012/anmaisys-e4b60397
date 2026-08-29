import { railEdge } from "@/lib/rail";
import type { PmStatus } from "@/hooks/usePreventiveMaintenance";

/**
 * O estado de um plano de preventiva, dito com as mesmas cores em todo o lado.
 *
 * Vivia dentro da PreventiveMaintenancePage. O calendario diz exactamente a mesma
 * coisa — vencido, a vencer, agendado — e uma segunda tabela de cores ao lado desta
 * separava-se dela ao primeiro acerto. Um vencido tem de ter o mesmo vermelho nas
 * duas vistas, ou as duas vistas deixam de ser do mesmo ecra.
 *
 * `ring` e a barra lateral do cartao da lista; `chip` e a etiqueta, usada nas duas.
 *
 * A barra vem do mecanismo, nao de uma cor escolhida aqui: um plano em atraso tem de
 * ter exactamente o mesmo vermelho, e a mesma largura, que uma linha parada no painel
 * de producao. `inactive` era `border-l-muted` — quase invisivel sobre o cartao.
 */
export const statusStyle: Record<PmStatus, { label: string; chip: string; ring: string }> = {
  overdue: { label: "Overdue", chip: "bg-destructive/15 text-destructive-strong border-destructive/40", ring: railEdge("stop") },
  due_soon: { label: "Due Soon", chip: "bg-warning/15 text-warning-strong border-warning/40", ring: railEdge("hold") },
  ok: { label: "Scheduled", chip: "bg-success/15 text-success-strong border-success/40", ring: railEdge("go") },
  inactive: { label: "Inactive", chip: "bg-muted text-muted-foreground border-border", ring: railEdge("idle") },
};
