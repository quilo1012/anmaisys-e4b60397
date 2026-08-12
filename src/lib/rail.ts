import { cn } from "@/lib/utils";

/**
 * Os quatro estados, e a barra que os diz.
 *
 * Vivem aqui, e não dentro do componente, por causa da camada: `qualityConstants.ts` é
 * uma tabela de constantes que muita coisa importa, e fazê-la depender de um componente
 * React para saber que cor tem uma acção crítica é pôr o desenho a puxar a aplicação
 * pelo lado errado. O `StatusRail` reexporta os dois, para que nada do que já os importa
 * de lá tenha de mudar.
 *
 * `go` em ordem · `hold` atenção · `stop` parado · `idle` sem leitura.
 */
export type RailState = "go" | "hold" | "stop" | "idle";

/**
 * A barra de estado para quem já tem a sua própria moldura.
 *
 * Um `<Card>` com o seu `<CardContent className="p-3">` lá dentro não pode virar
 * `<StatusRail>` sem que o padding mude por baixo dos pés de quem o escreveu — e havia
 * onze ficheiros nessa situação, cada um com o seu `border-l-4 border-l-<cor>` escrito
 * à mão. Isso é o mecanismo da barra copiado onze vezes, com onze oportunidades de
 * divergir: e divergiu, em `border-l-purple-500` (uma cor fora da paleta), em
 * `border-success` sem o `-l` (que contorna o cartão inteiro em vez do bordo), e em
 * quatro nomes diferentes para o mesmo azul.
 *
 * 3 px, como o `size="desk"` do componente — a largura é parte do mecanismo, e a 4 px a
 * barra deixa de ser a mesma coisa vista noutro ecrã. Sem banho: quem chama isto tem
 * fundo próprio.
 *
 *   <Card className={cn(railEdge(overdue ? "stop" : "go"))}>
 */
export function railEdge(state: RailState = "idle"): string {
  return cn(
    "border-l-[3px]",
    state === "go" && "border-l-success",
    state === "hold" && "border-l-warning",
    state === "stop" && "border-l-destructive",
    state === "idle" && "border-l-muted-foreground/40",
  );
}

/**
 * O banho de um ecrã inteiro em estado de andon.
 *
 * 7% — o suficiente para o ecrã "estar verde" a três metros sem que um número deixe de
 * se ler a trinta centímetros. Vive ao lado do `railEdge` porque é a mesma decisão a
 * outra escala: onde é que a cor deste estado pode entrar, e com que força.
 *
 * `idle` não tem banho. Um ecrã que não sabe não se tinge de nada.
 */
export const ANDON_FIELD: Record<RailState, string> = {
  go: "bg-success/[0.07]",
  hold: "bg-warning/[0.07]",
  stop: "bg-destructive/[0.07]",
  idle: "bg-transparent",
};
