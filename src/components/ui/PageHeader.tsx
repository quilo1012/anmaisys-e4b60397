import * as React from "react";
import { cn } from "@/lib/utils";
import { sameTitle, useShellTitle } from "@/components/shell/shellTitle";

export interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  /**
   * A placa de secção — "Produção", "Qualidade", "Manutenção". Diz em que parte do
   * sistema se está antes de dizer em que ecrã, que é a pergunta que se faz primeiro
   * quando se chega a um ecrã por um atalho ou por uma notificação.
   *
   * Opcional de propósito: 39 ecrãs já usam este cabeçalho e nenhum deve partir por
   * causa de uma propriedade nova.
   */
  module?: string;
  /**
   * O cabeçalho numa só linha, para ecrãs cujo trabalho é a grelha e não o título.
   *
   * A RAG abre com uma barra de comando de dois andares e uma grelha larga; o
   * cabeçalho alto empurrava tudo isso para baixo da dobra e o utilizador chegava ao
   * ecrã sem ver a semana. Aqui o módulo, o título e a descrição lêem-se como uma
   * migalha de pão: onde estou › o que é › para que serve. A descrição só aparece
   * onde há largura para ela — num portátil estreito é a primeira coisa a sair,
   * porque é a única que se pode adivinhar pelo resto do ecrã.
   */
  dense?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  badge,
  module,
  dense,
  className,
}: PageHeaderProps) {
  // On a phone the shell's top bar is already saying this title. When it is the same
  // screen name, the page does not say it a second time below 640px: the heading
  // stays for screen readers, the eyebrow and the description go, and what is left
  // is the row of actions. A page header that names something else — "Admin
  // Dashboard" half-way down the home screen — keeps its words.
  const echoes = sameTitle(useShellTitle(), title);
  // One <h1> either way: visually hidden below 640px when it echoes the top bar,
  // still there for a screen reader and for every test that looks it up by role.
  const h1Echo = echoes ? "sr-only sm:not-sr-only" : "";
  const onlyFromSm = echoes ? "hidden sm:inline" : "";
  const blockFromSm = echoes ? "hidden sm:block" : "";
  const flexFromSm = echoes ? "hidden sm:flex" : "flex";
  const empty = echoes && !actions && !badge;

  if (dense) {
    return (
      <div className={cn("mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2", empty && "mb-0 sm:mb-4", className)}>
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <div className={cn("shrink-0 items-center justify-center rounded-md bg-muted p-1.5 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4", flexFromSm)}>
              {icon}
            </div>
          )}
          {module && (
            <>
              <span className={cn("font-display text-2xs font-semibold uppercase tracking-[0.13em] text-muted-foreground", onlyFromSm)}>
                {module}
              </span>
              <span className={cn("text-muted-foreground/50", onlyFromSm)} aria-hidden>/</span>
            </>
          )}
          <h1 className={cn("truncate font-display text-lg font-bold leading-tight tracking-[-0.015em] text-foreground", h1Echo)}>
            {title}
          </h1>
          {badge}
          {description && (
            <>
              <span className="hidden h-4 w-px shrink-0 bg-border xl:block" aria-hidden />
              <p className="hidden truncate text-xs text-muted-foreground xl:block">{description}</p>
            </>
          )}
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
      </div>
    );
  }

  // On a phone the shell's top bar already names the screen (see `echoes` above).
  // When this header names something else it stays, but smaller: 22px instead of
  // 27px, no icon tile, the description held to two lines, the actions on a row
  // of their own instead of wrapping one button at a time.
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-8 sm:gap-5", empty && "mb-0 sm:mb-8", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="hidden shrink-0 items-center justify-center rounded-md bg-muted p-2 text-muted-foreground sm:flex">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {module && (
            // Archivo em caixa alta e apertado: é a face das chapas de máquina, e é o
            // único sítio onde entra além do título. Uma voz que aparece em todo o lado
            // deixa de ser uma voz.
            <div className={cn("mb-1 font-display text-2xs font-semibold uppercase tracking-[0.13em] text-muted-foreground", blockFromSm)}>
              {module}
            </div>
          )}
          <div className="flex items-center gap-2">
            <h1 className={cn("truncate font-display text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground sm:text-[27px]", h1Echo)}>
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <p className={cn("mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground sm:line-clamp-none sm:text-sm", blockFromSm)}>{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

export default PageHeader;
