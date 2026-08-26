import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A régua de medidas de um painel.
 *
 * Uma fila de números que se lêem juntos — feito, planeado, desvio, sessões — não são
 * quatro cartões, são quatro casas da mesma régua. Separados por filetes e não por
 * molduras, comparam-se; em cartões soltos, cada um pede a sua própria atenção e a
 * comparação, que é a razão de estarem lado a lado, tem de ser feita de cabeça.
 *
 * Substitui o padrão que estava escrito à mão em vários ecrãs: um `<Card>` por medida,
 * cada um com `border-l-4 border-l-primary`. Uma barra que está sempre acesa não diz
 * nada — e gasta, num KPI que não tem estado, o mecanismo com que o `StatusRail` diz o
 * estado de uma linha três ecrãs adiante.
 */
export function ConsoleStrip({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Uma casa da régua: a chapa gravada por cima, o número na face de algarismos.
 *
 * `tone` é para a única medida da régua que pode estar boa ou má. Duas ou três casas
 * coloridas ao mesmo tempo e a régua deixa de ter uma leitura — passa a ter quatro.
 */
export function ConsoleCell({
  label,
  value,
  hint,
  tone,
  className,
  onClick,
  active,
  title,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
  className?: string;
  /** Quando dado, a casa passa a ser um botão — a medida é também a pergunta seguinte. */
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const body = (
    <>
      <div className="font-display text-2xs font-bold uppercase leading-none tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1.5 font-figure text-xl font-bold leading-none", tone ?? "text-foreground")}>
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-2xs text-muted-foreground">{hint}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={active}
        className={cn(
          "w-full px-5 py-3.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-accent/60",
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={cn("px-5 py-3.5", className)}>{body}</div>;
}


export default ConsoleStrip;
