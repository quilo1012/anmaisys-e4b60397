import * as React from "react";
import { cn } from "@/lib/utils";
import type { RailState } from "@/lib/rail";

/**
 * O andon.
 *
 * Uma lâmpada por cima da linha, que diz de longe se se está a ganhar ou a perder o
 * turno. É a única coisa neste sistema que leva cor a cheio — em todo o resto a cor
 * entra por um bordo de 3 px, e a razão é a mesma nos dois casos: um painel onde tudo
 * grita não tem nada que se ouça. Aqui grita uma coisa só, e é a resposta à pergunta
 * que se faz da porta da fábrica.
 *
 * Branco sobre as três cores passa AA — 5.39:1 no verde, 5.32:1 no âmbar, 6.60:1 no
 * vermelho. Foi por isso que os tokens foram escolhidos escuros; é aqui que essa
 * escolha se cobra.
 *
 * `idle` não é uma quarta cor de sinalética: é a ausência de leitura. Um andon cinzento
 * diz "não sei", que é diferente de "está mal" — e pintá-lo de vermelho quando não há
 * plano nenhum seria o ecrã a inventar um problema.
 */
const FIELD: Record<RailState, string> = {
  go: "bg-success text-success-foreground",
  hold: "bg-warning text-warning-foreground",
  stop: "bg-destructive text-destructive-foreground",
  idle: "bg-muted text-muted-foreground",
};

export function AndonBar({
  state,
  verdict,
  value,
  basis,
  detail,
  className,
}: {
  state: RailState;
  /** O veredicto por palavras. Sobrevive a quem não distingue as três cores. */
  verdict: string;
  /** A percentagem já formatada, ou null quando não há leitura. */
  value: string | null;
  /** Contra o quê é que isto foi medido. Sem isto, 104% é um número sem pergunta. */
  basis: string;
  /** Feito e devido, para quem quer o número em peças e não em percentagem. */
  detail?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg px-5 py-4 sm:px-6 sm:py-5",
        FIELD[state],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0">
        <div className="font-display text-2xl font-bold uppercase leading-none tracking-[0.08em] sm:text-[2rem]">
          {verdict}
        </div>
        <div className="mt-2 text-2xs font-semibold uppercase tracking-[0.12em] opacity-80">
          {basis}
        </div>
      </div>
      <div className="flex items-baseline gap-4 sm:gap-6">
        {detail && (
          <div className="hidden text-right font-figure text-sm font-bold opacity-90 sm:block">
            {detail}
          </div>
        )}
        {value && (
          <div className="font-figure text-[2.75rem] font-bold leading-none tracking-[-0.03em] sm:text-[3.5rem]">
            {value}
          </div>
        )}
      </div>
    </div>
  );
}

export default AndonBar;
