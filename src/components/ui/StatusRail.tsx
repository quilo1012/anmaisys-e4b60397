import * as React from "react";
import { cn } from "@/lib/utils";
import { railEdge, type RailState } from "@/lib/rail";

/* Reexportados: a barra em texto vive em `@/lib/rail` — uma tabela de constantes não
   pode depender de um componente React só para saber que cor tem um estado. Quem já os
   importava daqui continua a importá-los daqui. */
export { railEdge };
export type { RailState };

/**
 * A cor desce dos tokens por uma variável, e não por uma classe por estado, para que a
 * barra e o banho não possam divergir: são a mesma `--rail` lida duas vezes.
 */
const RAIL_COLOR: Record<RailState, string> = {
  go: "[--rail:hsl(var(--success))]",
  hold: "[--rail:hsl(var(--warning))]",
  stop: "[--rail:hsl(var(--destructive))]",
  idle: "[--rail:hsl(var(--muted-foreground))]",
};

export interface StatusRailProps extends React.HTMLAttributes<HTMLDivElement> {
  state?: RailState;
  /**
   * `desk` é a densidade de secretária. `floor` é o ecrã de linha: a barra passa a
   * 8 px porque 3 px desaparecem do outro lado de uma linha de enchimento, que é o
   * risco real de pôr o estado num bordo em vez de num preenchimento.
   */
  size?: "desk" | "floor";
  /**
   * Enche a altura da célula da grelha, e passa o conteúdo a coluna flex.
   *
   * Num painel, os cartões são lidos aos pares e às linhas: o olho corre na
   * horizontal pela mesma medida em quatro linhas de enchimento. Se um cartão tiver
   * mais uma legenda do que o vizinho, o número grande desce dois centímetros e a
   * leitura horizontal deixa de existir. Com isto, o filho pode empurrar o bloco de
   * medida com `mt-auto` e os quatro números assentam na mesma linha.
   */
  fill?: boolean;
  asChild?: never;
}

/**
 * A barra de estado.
 *
 * Uma barra no bordo de tudo o que tem estado — cartão de linha, ordem de trabalho,
 * acção de qualidade, célula de alocação. É a marcação pintada no chão da fábrica
 * trazida para o ecrã, e é o único sítio de onde a cor entra.
 *
 * A razão de existir é mecânica, não decorativa. Havia 1290 classes de cor escritas à
 * mão espalhadas por 102 ficheiros — `bg-emerald-500` aqui, `text-amber-600` ali — cada
 * uma uma decisão tomada de novo, e é essa repetição que faz o sistema parecer montado
 * por várias mãos. Um mecanismo com quatro estados não deixa margem para a próxima
 * decisão ser diferente da anterior.
 *
 * A cor aparece duas vezes e as duas em surdina: a barra, e um banho a 9% que se esvai
 * ao longo do cartão. Um preenchimento cheio faria o estado gritar mais alto do que o
 * número que o cartão existe para mostrar, e num painel com seis cartões grita-se
 * todos ao mesmo tempo, que é o mesmo que não gritar nenhum.
 */
export function StatusRail({
  state = "idle",
  size = "desk",
  fill = false,
  className,
  children,
  ...props
}: StatusRailProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card",
        fill && "flex h-full flex-col",
        size === "desk" ? "p-5 pl-[calc(1.25rem+3px)]" : "p-5 pl-[calc(1.25rem+8px)]",
        RAIL_COLOR[state],
        // A barra.
        "before:absolute before:inset-y-0 before:left-0 before:bg-[var(--rail)] before:content-['']",
        size === "desk" ? "before:w-[3px]" : "before:w-[8px]",
        // O banho. Esvai-se a 62% da largura: o suficiente para o estado se ler de
        // relance sem que o cartão passe a ser um bloco colorido.
        "after:pointer-events-none after:absolute after:inset-0 after:opacity-[0.09] after:content-['']",
        "after:bg-[linear-gradient(100deg,var(--rail),transparent_62%)]",
        className,
      )}
      {...props}
    >
      {/* Posicionado, e depois do ::after na ordem de pintura, para que o banho fique
          por baixo do conteúdo em vez de por cima dele. */}
      <div className={cn("relative z-10", fill && "flex min-h-0 flex-1 flex-col")}>{children}</div>
    </div>
  );
}

/**
 * A mesma barra numa linha de tabela.
 *
 * Aplica-se à primeira célula como bordo esquerdo, e não como uma coluna de 3 px: um
 * `<td>` não respeita `width`, e o navegador alarga-o para o que lhe apetecer. Sem
 * banho — numa tabela densa o banho por linha vira listras.
 *
 *   <tr>
 *     <td className={railCell(state)}>WO-2419</td>
 */
export function railCell(state: RailState = "idle"): string {
  return cn(
    "border-l-[3px] pl-5",
    state === "go" && "border-l-success",
    state === "hold" && "border-l-warning",
    state === "stop" && "border-l-destructive",
    state === "idle" && "border-l-muted-foreground",
  );
}

export default StatusRail;
