import * as React from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A placa de comando, e a chapa de cada manípulo.
 *
 * Uma fila de campos soltos por cima de um painel lê-se como um formulário. O que eles
 * são é a afinação do instrumento que está por baixo — e numa placa de comando cada
 * manípulo tem a sua chapa gravada por cima. Sem elas, um selector que diz "Day" e
 * outro ao lado que diz "All" são duas respostas sem as perguntas.
 *
 * Vive aqui, e não dentro de um ecrã, porque a Performance e a RAG têm o mesmo tipo de
 * barra e já a tinham escrito de duas maneiras: uma fila nua num lado, um cartão com
 * gradiente e bordo azul de 4 px no outro. Duas gramáticas para o mesmo objecto é como
 * um sistema começa a parecer montado por várias mãos.
 */
export function ControlPlate({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border bg-card p-3", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Uma linha da placa, quando ela tem mais do que uma.
 *
 * O filete é o que separa o que se navega do que se filtra. Sem ele, dez controlos
 * empilhados são dez controlos.
 */
export function ControlRow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex w-full flex-wrap items-end gap-x-4 gap-y-3", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * A chapa gravada de um controlo.
 *
 * `div` e não `label` de propósito — o `SelectTrigger` do Radix é um botão, e um label
 * à volta reenvia-lhe o clique, o que abre e fecha a lista no mesmo gesto.
 */
export function ControlField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-display text-2xs font-bold uppercase leading-none tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * O separador vertical entre grupos de controlos, à altura de um controlo.
 * Escondido em ecrãs estreitos, onde os grupos já se separam por quebra de linha.
 */
export function ControlDivider({ className }: { className?: string }) {
  return <div className={cn("hidden h-10 w-px self-end bg-border lg:block", className)} aria-hidden />;
}

/**
 * O marcador da placa: o que o instrumento está a marcar com os manípulos como estão.
 *
 * Estava numa régua de quatro cartões, uma faixa acima — `Produced`, `Target`,
 * `Attainment`, `Days`. Uma régua compara medidas entre si, e é para isso que serve;
 * estas quatro não se comparam umas com as outras, confirmam o que os manípulos ao
 * lado escolheram. Postas numa moldura própria, mandavam o leitor subir e descer entre
 * a pergunta e a resposta. No extremo da mesma placa lêem-se de uma vez: mudou-se o
 * turno, o número ao lado mexeu.
 *
 * `tone` é para a única medida que pode estar boa ou má. Duas medidas coloridas ao
 * mesmo tempo e o marcador deixa de ter uma leitura, passa a ter duas.
 */
export function ControlReadout({
  label,
  value,
  against,
  tone,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** O planeado, contra o qual o valor se lê. Fica na mesma linha, em letra de fundo. */
  against?: React.ReactNode;
  tone?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-display text-2xs font-bold uppercase leading-none tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {/* No fixed height below 640px: in a three-across phone row "40,571 / 67,485"
          does not fit one line, and the plan wraps under the figure instead. */}
      <div className="flex min-h-9 flex-col justify-center sm:h-9">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className={cn("font-figure text-lg font-bold leading-none", tone ?? "text-foreground")}>
            {value}
          </span>
          {against && (
            <span className="font-figure text-xs leading-none text-muted-foreground">/ {against}</span>
          )}
        </div>
        {hint && <div className="mt-1 truncate text-2xs leading-none text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

/**
 * The plate's secondary knobs, folded away on a phone.
 *
 * On a 390px phone the Performance plate was six controls stacked in pairs — about
 * 330px of the first screen — and Production Control's five were taller still. The
 * primary knob (the dates) stays out; the rest sit behind one row that says what
 * they are set to, so a filter that is on is never invisible: "Day · Night · Line 3".
 *
 * From 640px up the toggle disappears and the children are laid out exactly where
 * they were (`sm:contents`), so the desktop plate is untouched.
 */
export function ControlDisclosure({
  summary,
  active = 0,
  children,
  className,
}: {
  /** What the folded knobs are set to, in words. */
  summary: string;
  /** How many of them are away from their default; shown as a count. */
  active?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-md border border-input bg-background px-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden",
          className,
        )}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">Filters</span>
        {active > 0 && (
          <span className="shrink-0 rounded-full bg-primary px-1.5 text-2xs font-semibold leading-5 text-primary-foreground">{active}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <div id={id} className={cn("w-full sm:contents", open ? "grid grid-cols-2 gap-3" : "hidden")}>
        {children}
      </div>
    </>
  );
}

export default ControlPlate;
