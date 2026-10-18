import { useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { matchCellName, type CellCandidate } from "@/lib/cellNameMatch";

/**
 * A célula vazia de uma coluna, onde se escreve um nome como na folha.
 *
 * Escrever abre uma lista curta de quem responde ao que foi escrito; Enter ou um toque
 * põe essa pessoa na coluna. Só se grava uma pessoa do cadastro — nunca o texto
 * escrito — por isso o que fica no board é sempre alguém que se sabe quem é.
 *
 * A lista diz onde cada pessoa está agora ("Line 3", "Holidays"), porque escolher
 * alguém que já está noutra linha muda-o de linha, e isso tem de se ver antes.
 */
export function SheetCellInput<T extends CellCandidate>({
  people, columnName, whereNow, onPick, className,
}: {
  people: T[];
  columnName: string;
  /** Onde a pessoa está hoje neste board, ou null. */
  whereNow: (id: string) => string | null;
  onPick: (id: string) => void;
  className?: string;
}) {
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hits = useMemo(() => matchCellName(typed, people), [typed, people]);

  const pick = (p: T | undefined) => {
    if (!p) return;
    onPick(p.id);
    setTyped("");
    setActive(0);
  };

  return (
    <div className={cn("relative", className)}>
      <input
        value={typed}
        onChange={(e) => { setTyped(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Depois do clique na lista: um blur imediato fechava-a antes de o clique chegar.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(hits[active]); }
          else if (e.key === "Escape") { setTyped(""); setOpen(false); }
        }}
        placeholder="Type a name"
        aria-label={`Add a person to ${columnName}`}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        // "Type a name" em todas as colunas era a palavra mais repetida do board. Fica um
        // "+" discreto; o texto aparece ao passar pela coluna ou ao tocar na célula.
        className="peer h-full w-full bg-transparent px-2 text-center text-sm placeholder:text-transparent focus:bg-primary/5 focus:outline-none focus:placeholder:text-muted-foreground/70 group-hover/col:placeholder:text-muted-foreground/50"
      />
      {!typed && (
        <Plus
          aria-hidden
          className="pointer-events-none absolute inset-0 m-auto h-4 w-4 text-muted-foreground/35 group-hover/col:opacity-0 peer-focus:opacity-0"
        />
      )}
      {open && typed.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 max-h-64 overflow-auto border border-neutral-900 bg-popover text-left shadow-md dark:border-neutral-400"
        >
          {hits.length === 0 && (
            <li className="px-2 py-2 text-xs text-muted-foreground">Nobody by that name</li>
          )}
          {hits.map((p, i) => {
            const now = whereNow(p.id);
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                // mousedown, não click: chega antes do blur do campo.
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-2 py-1.5 text-sm", i === active && "bg-accent text-accent-foreground")}
              >
                <span className="font-medium">{p.full_name}</span>
                {p.employee_ref && <span className="ml-1 font-figure text-2xs text-muted-foreground">#{p.employee_ref}</span>}
                {now && <span className="block text-2xs text-muted-foreground">now: {now}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
