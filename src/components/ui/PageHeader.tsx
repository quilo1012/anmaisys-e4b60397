import * as React from "react";
import { cn } from "@/lib/utils";

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
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  badge,
  module,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-8 flex flex-wrap items-end justify-between gap-5", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="flex shrink-0 items-center justify-center rounded-md bg-muted p-2 text-muted-foreground">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {module && (
            // Archivo em caixa alta e apertado: é a face das chapas de máquina, e é o
            // único sítio onde entra além do título. Uma voz que aparece em todo o lado
            // deixa de ser uma voz.
            <div className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              {module}
            </div>
          )}
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-foreground">
              {title}
            </h2>
            {badge}
          </div>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
