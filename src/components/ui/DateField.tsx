import * as React from "react";
import { format, parseISO, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Uma data, escrita como o sistema escreve as datas.
 *
 * O `<input type="date"/>` nativo imprime na LOCALE DO BROWSER, e isso não é uma
 * preferência que a app possa exprimir: com o Chrome em en-US — que é como a maioria
 * das máquinas do escritório vem configurada — a placa de comando da Performance dizia
 * "08/13/2026" a dois centímetros de uma barra que dizia "13 Aug 2026". Duas datas, dois
 * formatos, no mesmo ecrã, com o dia e o mês trocados num deles. Numa fábrica onde os
 * turnos se fecham por dia, isso não é feio, é ambíguo: 08/13 não existe como dia 8, mas
 * 05/06 existe nas duas leituras e ninguém consegue dizer qual é.
 *
 * O que fica no lugar dele é o mesmo mecanismo que o `DateRangeFilter` já usa neste
 * projecto — botão, popover, calendário — reduzido a um dia e a falar a língua da base
 * de dados: entra e sai `yyyy-MM-dd`, que é como as `session_date` e as `entry_date`
 * estão escritas. Não é um controlo novo no sistema; é o que já existia, na medida que
 * faltava.
 *
 * Fica um campo, e não um input, também pelo que se vê: numa placa de comando, ao lado
 * de selectores com a sua chapa gravada, o quadradinho com o calendário do sistema
 * operativo dentro era a única peça do ecrã que não era deste ecrã.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  /** A data em `yyyy-MM-dd`, ou string vazia quando não há nenhuma. */
  value: string;
  onChange: (value: string) => void;
  /** Limites, também em `yyyy-MM-dd`. Um dia fora deles não se pode escolher. */
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);

  const parse = (v: string | undefined) => {
    if (!v) return undefined;
    const d = parseISO(v);
    return isValid(d) ? d : undefined;
  };

  const selected = parse(value);
  const minDate = parse(min);
  const maxDate = parse(max);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          /* `font-figure`: é um número que se compara com outro número — o da barra de
             cima, o do cartão ao lado — e a face de algarismos é o que os alinha.
             Sem o ícone de calendário que aqui esteve: "13 Aug 2026" em IBM Plex Mono
             mede 92 px e o ícone mais o seu intervalo mediam 24 — numa caixa de 140 a
             data truncava para "13 Aug 20…", que é uma data sem ano ao lado de outra
             igual. Entre o ícone e o ano, fica o ano. O que se abre já está dito pelo
             botão: uma data numa chapa "Date range", entre duas setas de passo. */
          className={cn("h-10 justify-center px-2.5 font-figure text-sm font-normal", className)}
        >
          {/* Um travessão, e não a data de hoje: um campo vazio que se pinta com hoje
              está a responder por quem ainda não respondeu. */}
          <span className="truncate">{selected ? format(selected, "dd MMM yyyy") : "—"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? new Date()}
          disabled={
            minDate || maxDate
              ? (d: Date) => (minDate ? d < minDate : false) || (maxDate ? d > maxDate : false)
              : undefined
          }
          onSelect={(d) => {
            if (!d) return;
            onChange(format(d, "yyyy-MM-dd"));
            setOpen(false);
          }}
          initialFocus
          className="pointer-events-auto p-0"
        />
      </PopoverContent>
    </Popover>
  );
}

export default DateField;
