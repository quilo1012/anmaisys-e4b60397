import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COUNT_INPUT, readNumberEdit } from "@/lib/scorecardNumberInput";

/**
 * Um campo numerico que se consegue teclar.
 *
 * O que estava antes era `value={n ?? ""}` com `onChange={parseNullableNumber}` — o que
 * aparece no ecra reconstruido a partir do numero, a cada tecla. Para contadores
 * inteiros isso passa despercebido; para os quatro campos `numeric(5,4)` entre 0 e 1
 * (`ppe_compliance_pct`, `hs_training_compliance_pct`, `leader_attendance_pct`,
 * `team_attendance_pct`) torna-os impossiveis de preencher, e por DUAS razoes que se
 * somam:
 *
 *   1. `Number("0.")` da 0, portanto o estado volta a "0" e o ponto desaparece no
 *      instante em que e teclado (ver `readNumberEdit`);
 *   2. um `<input type="number">` nem sequer deixa `"0."` chegar ao `onChange` — o
 *      valor sanitizado e `""`, tanto no browser como em jsdom. Nenhum estado local
 *      resolve isso, porque o texto parcial nunca sai do input.
 *
 * Por isso os campos decimais sao `type="text"` com `inputMode="decimal"`: o teclado
 * do telemovel continua a ser o numerico, e o texto a meio sobrevive. Os contadores
 * inteiros, que nao tem o problema, ficam `type="number"` com os limites do CHECK
 * restated na caixa, como estavam.
 *
 * O estado numerico continua a ser a verdade — este componente nunca inventa um valor,
 * e um campo esvaziado escreve `null` e nunca `0`.
 */
export function NumericField({
  id,
  label,
  value,
  onChange,
  caption,
  bounds = COUNT_INPUT,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  caption?: string;
  /** The database's own domain, restated on the box. Counters by default. */
  bounds?: { min: number; max?: number; step: number };
}) {
  const decimal = bounds.step < 1;
  const [text, setText] = useState(() => (value === null ? "" : String(value)));

  // O ultimo valor que ESTE campo emitiu. Serve para distinguir "o rascunho mudou
  // porque eu escrevi" de "o rascunho mudou por fora" — um carregamento, ou o
  // "Use this number" de outro sitio. So o segundo pode reescrever o texto, senao
  // cada tecla normalizava o que se esta a escrever.
  const emitted = useRef<number | null>(value);

  useEffect(() => {
    if (value !== emitted.current) {
      setText(value === null ? "" : String(value));
      emitted.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    // Num `type="number"`, o browser devolve "" enquanto o texto nao for um numero
    // completo, e marca `badInput`. Sair aqui sem tocar no estado impede que esse ""
    // seja lido como "o campo foi esvaziado".
    if (el.validity?.badInput) return;

    setText(el.value);
    const edit = readNumberEdit(el.value);
    if (edit.kind === "pending") return;
    emitted.current = edit.value;
    onChange(edit.value);
  };

  // Fora do intervalo que a coluna aceita. Num campo de texto nao ha validacao nativa
  // a fazer este trabalho, e 95 num campo que so aceita 0..1 e precisamente o engano
  // que a etiqueta "(0–1)" existe para evitar — dito duas vezes, nao uma.
  const outOfRange =
    value !== null &&
    (value < bounds.min || (bounds.max !== undefined && value > bounds.max));

  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        {...(decimal
          ? { type: "text" as const, inputMode: "decimal" as const }
          : { type: "number" as const, min: bounds.min, max: bounds.max, step: bounds.step })}
        value={text}
        onChange={handleChange}
        aria-invalid={outOfRange || undefined}
        aria-describedby={outOfRange ? `${id}-range` : undefined}
        className="mt-1 h-9"
      />
      {outOfRange && (
        <p id={`${id}-range`} className="mt-1 text-2xs text-destructive-strong">
          {bounds.max === undefined
            ? `Must be ${bounds.min} or more.`
            : `Must be between ${bounds.min} and ${bounds.max}.`}
        </p>
      )}
      {caption && <p className="mt-1 text-2xs text-muted-foreground">{caption}</p>}
    </div>
  );
}
