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
  scale,
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
  /**
   * A mesma escala dos cartões de linha, à escala da fábrica: o enchimento é o
   * que está feito, a marca é onde o relógio do turno já vai, e a distância entre
   * as duas É o veredicto que a palavra ao lado nomeia.
   *
   * Substituiu um anel de progresso que vivia num cartão à parte. O anel colorava-se
   * pela percentagem absoluta enquanto a barra se colorava pelo ritmo, e o resultado
   * era um anel VERMELHO a 65% por baixo de uma barra VERDE a dizer ON TARGET — o
   * mesmo número com dois veredictos, a dois palmos um do outro. Aqui há um só
   * instrumento, e a gramática é a que os cartões já usavam.
   *
   * `elapsedPct` é null num período fechado: o relógio não está a correr, o plano
   * inteiro já era devido, e uma marca desenhada aí seria precisão inventada.
   */
  scale?: { attainedPct: number; elapsedPct: number | null };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-5 py-4 sm:px-6 sm:py-5",
        FIELD[state],
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
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
      {/* A escala é da própria tinta do texto, sobre o campo de cor: o estado já foi
          dito pelo fundo, e uma segunda cor aqui dentro seria a lâmpada a acender
          duas vezes. Sem legenda — o veredicto e o relógio já estão escritos por
          palavras duas linhas acima, e legendá-los aqui seria dizê-los a terceira. */}
      {scale && (
        <div className="relative mt-4 h-2.5 w-full overflow-hidden rounded-[2px]">
          <div className="absolute inset-0 bg-current opacity-20" aria-hidden />
          <div
            className="absolute inset-y-0 left-0 bg-current opacity-95"
            style={{ width: `${Math.min(100, Math.max(0, scale.attainedPct))}%` }}
            aria-hidden
          />
          {/* A marca do relógio é um ENTALHE, não um traço.
              Desenhada da mesma tinta do enchimento, desaparecia dentro dele: com 65%
              feito e 39% do turno passado, a marca caía em cima da parte cheia e a
              distância entre as duas — que é o relatório inteiro — não se via. Aqui
              abre-se uma fenda da cor do campo e é essa fenda que se lê, cheia ou
              vazia a barra por baixo. */}
          {scale.elapsedPct != null && (
            <div
              className={cn("absolute inset-y-0 flex w-[9px] -translate-x-1/2 justify-center", FIELD[state])}
              style={{ left: `${Math.min(100, Math.max(0, scale.elapsedPct))}%` }}
              title={`${Math.round(scale.elapsedPct)}% of the shift has passed`}
              aria-hidden
            >
              <div className="w-[3px] bg-current opacity-95" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AndonBar;
