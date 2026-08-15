/**
 * O veredicto tal como a base o deu. Este ficheiro NAO decide bandas: se algum dia
 * aparecer aqui uma comparacao numerica, a regra passou a ter duas definicoes.
 */
export function ragLabel(value: string | null): string {
  return value ?? "—";
}

const TONE: Record<string, string> = {
  Red: "bg-destructive/10 text-destructive",
  Amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Green: "bg-success/10 text-success",
  "Sem dados": "bg-muted text-muted-foreground",
};

export function RagChip({ value }: { value: string | null }) {
  const tone = value ? TONE[value] ?? "bg-muted text-muted-foreground" : "bg-transparent text-muted-foreground";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {ragLabel(value)}
    </span>
  );
}
