# Acções de segurança no log da qualidade — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registar ocorrências de Health & Safety no mesmo log da qualidade, separadas por domínio, sem que nenhuma delas cobre pontos a um líder.

**Architecture:** Duas colunas em `quality_actions` (`domain`, `safety_kind`) e nenhuma tabela nova. A pontuação é anulada numa única linha dentro de `actionPoints()`, que é a função que todos os ecrãs já leem. A página ganha um selector Quality · Safety · All. Uma função SQL conta as ocorrências por líder × linha × semana, para o pilar de H&S do scorecard deixar de ser escrito à mão.

**Tech Stack:** PostgreSQL (Supabase), React 18, TypeScript, TanStack Query, shadcn/ui, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-16-safety-actions-in-the-quality-log-design.md](../specs/2026-08-16-safety-actions-in-the-quality-log-design.md)

## Global Constraints

- **Segurança não pontua. Nunca.** A única linha que o decide vive em `actionPoints()`. Qualquer outro ficheiro que teste `domain === "safety"` para zerar um número está a duplicar a regra e é motivo para rejeitar a tarefa.
- **Reportar é bom.** Um quase-acidente registado nunca pode piorar o número de ninguém. Zero reportados é que é o sinal mau, e essa leitura vive no scorecard, não aqui.
- **Primeiros socorros e quase-acidentes nunca se somam.** Um é consequência, o outro é sinal antecedente. Não podem partilhar um total, uma cor, nem uma coluna.
- **Vazio nunca é zero.** Uma contagem sobre um grupo sem registos é ausência, não zero.
- **Uma linha de segurança sem líder ou sem linha não se conta em silêncio** — aparece no bloco de integridade.
- **Interface em inglês**, comentários de código em inglês, esta documentação em português.
- **Comandos:** `npm run test`, `npm run typecheck`, `npm run lint`. Nunca `npx tsc --noEmit` na raiz — não verifica nada neste repo.
- **Commits com pathspec explícito.** Há outro actor a escrever no índice deste repo; `git add -A` e `git add .` são proibidos. Nunca `git stash` — a pilha é partilhada e as entradas são de outros ramos.

---

### Task 1: As duas colunas e o vocabulário, na base

**Files:**
- Create: `supabase/migrations/20260817090000_safety_shares_the_log_but_not_the_score.sql`

**Interfaces:**
- Produces: `quality_actions.domain` (`'quality' | 'safety'`, NOT NULL, default `'quality'`); `quality_actions.safety_kind` (enum, nulo excepto em segurança).

- [ ] **Step 1: Escrever a migração**

```sql
-- Safety shares the log, but not the score.
--
-- A safety occurrence has the same life as a quality one — recorded, owned, validated,
-- closed, with attachments — so it gets the same table rather than a parallel one that
-- would duplicate the validation and closure machinery and then rot beside it.
--
-- What must NOT be shared is the arithmetic. The quality module charges points to a
-- leader: more actions recorded, worse. Safety runs the other way — reporting a near
-- miss is the behaviour we want, and zero reported means under-reporting rather than a
-- safe line. Wire the two into one score and logging a near miss would penalise the
-- leader who logged it, which teaches the whole team not to log them. So the score is
-- switched off for this domain, in exactly one place: `actionPoints()` in
-- src/lib/qualityConstants.ts.

DO $$ BEGIN
  CREATE TYPE public.action_domain AS ENUM ('quality', 'safety');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.safety_kind AS ENUM (
    'lost_time_injury', 'reportable_accident', 'first_aid', 'near_miss',
    'safety_observation', 'toolbox_talk', 'ppe_breach');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS domain public.action_domain NOT NULL DEFAULT 'quality',
  ADD COLUMN IF NOT EXISTS safety_kind public.safety_kind;

-- Both contradictions are refused: a safety row nobody classified, and a quality row
-- carrying a safety type. Either one would reach the weekly counts as a silent wrong
-- answer rather than an error.
DO $$ BEGIN
  ALTER TABLE public.quality_actions
    ADD CONSTRAINT quality_actions_safety_kind_matches_domain
    CHECK ((domain = 'safety') = (safety_kind IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS quality_actions_domain_idx
  ON public.quality_actions (domain, recorded_at DESC);
-- The weekly counts group by leader, line and week within one domain.
CREATE INDEX IF NOT EXISTS quality_actions_safety_counts_idx
  ON public.quality_actions (domain, leader_id, line, recorded_at)
  WHERE domain = 'safety';

COMMENT ON COLUMN public.quality_actions.domain IS
  'Quality or safety. Every row that existed before this column is quality, which is what the default says. Safety rows are counted, never scored: see actionPoints() in src/lib/qualityConstants.ts.';
COMMENT ON COLUMN public.quality_actions.safety_kind IS
  'What kind of safety occurrence. first_aid and near_miss are DIFFERENT THINGS and must never be summed: the first is a consequence, the second is a leading signal, and a near miss reported is a good outcome.';
```

- [ ] **Step 2: Verificar que a tabela existe antes de assumir que a migração pega**

```bash
set -a && . ./.env && set +a
curl -s -o /dev/null -w '%{http_code}\n' \
  "$VITE_SUPABASE_URL/rest/v1/quality_actions?select=id&limit=1" \
  -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY"
```

Esperado: `200`. A migração NÃO pode ser corrida por um agente — exige o SQL Editor. Registar como não corrida e seguir; o resto do plano não depende de ela estar aplicada, excepto a Task 7.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260817090000_safety_shares_the_log_but_not_the_score.sql
git commit -m "Safety shares the log, but not the score"
```

---

### Task 2: A linha que mata a pontuação

**Files:**
- Modify: `src/lib/qualityConstants.ts` (`actionPoints`)
- Test: `src/__tests__/actionPoints.test.ts`

**Interfaces:**
- Produces: `actionPoints(action, excluded)` devolve 0 quando `action.domain === "safety"`, qualquer que seja a severidade ou a etiqueta.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/__tests__/actionPoints.test.ts`:

```ts
describe("safety never charges the leader", () => {
  const excluded = new Set<string>();

  it("scores zero however severe it was", () => {
    expect(actionPoints({ domain: "safety", severity: "critical", labels: [] }, excluded)).toBe(0);
  });

  it("scores zero even when a priced label would have charged", () => {
    // A priced label outranks severity in the quality path. It must not reach across
    // into safety and charge for a near miss.
    expect(actionPoints({ domain: "safety", severity: null, labels: ["Batch code"] }, excluded)).toBe(0);
  });

  it("still charges a quality action the same as before", () => {
    expect(actionPoints({ domain: "quality", severity: "critical", labels: [] }, excluded)).toBe(4);
  });

  it("treats a row with no domain as quality, so nothing already logged changes", () => {
    expect(actionPoints({ severity: "critical", labels: [] }, excluded)).toBe(4);
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/actionPoints.test.ts`
Esperado: FAIL — o objecto não aceita `domain`, e a acção de segurança devolve 4.

- [ ] **Step 3: Implementar**

Em `src/lib/qualityConstants.ts`, no tipo do parâmetro e na primeira linha do corpo:

```ts
export function actionPoints(
  action: { domain?: string | null; severity: string | null; labels?: string[] | null; validation_status?: string | null },
  excluded: Set<string>,
): number {
  // Safety is counted, never charged. Reporting a near miss is the behaviour we want,
  // and a score that punishes the report teaches the team to stop reporting. This is
  // the ONLY place the rule lives: the leader card, the quality breakdown and Analytics
  // all read this function, so they cannot disagree about it.
  if (action.domain === "safety") return 0;
  if (isRejected(action)) return 0;
  if (!countsAgainstLeader(action, excluded)) return 0;
  return labelChargeFor(action, excluded) || severityPoints(action.severity);
}
```

- [ ] **Step 4: Correr os testes**

Run: `npm run test && npm run typecheck`
Esperado: PASS nos dois. A suite inteira, não só o ficheiro: `actionPoints` é lida por muitos ecrãs e uma regressão aqui aparece longe daqui.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qualityConstants.ts src/__tests__/actionPoints.test.ts
git commit -m "Safety is counted, never charged"
```

---

### Task 3: O vocabulário das ocorrências, no cliente

**Files:**
- Modify: `src/lib/qualityConstants.ts`
- Test: `src/__tests__/safetyKinds.test.ts`

**Interfaces:**
- Produces: `SAFETY_KINDS: SafetyKind[]` com `{ value, label, group, badge }`; `safetyKindMeta(value): SafetyKind | null`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import { SAFETY_KINDS, safetyKindMeta } from "@/lib/qualityConstants";

describe("SAFETY_KINDS", () => {
  it("carries the seven kinds the log records", () => {
    expect(SAFETY_KINDS.map((k) => k.value)).toEqual([
      "lost_time_injury", "reportable_accident", "first_aid", "near_miss",
      "safety_observation", "toolbox_talk", "ppe_breach",
    ]);
  });

  it("keeps first aid and near miss in different groups", () => {
    // A consequence and a leading signal. Sharing a group is how they end up sharing a
    // total, and a total of the two answers no question anybody has.
    const firstAid = safetyKindMeta("first_aid");
    const nearMiss = safetyKindMeta("near_miss");
    expect(firstAid?.group).toBe("harm");
    expect(nearMiss?.group).toBe("signal");
  });

  it("groups the preventive activity apart from both", () => {
    expect(safetyKindMeta("toolbox_talk")?.group).toBe("prevention");
    expect(safetyKindMeta("safety_observation")?.group).toBe("prevention");
  });

  it("returns null for a value that is not a safety kind", () => {
    expect(safetyKindMeta("critical")).toBeNull();
    expect(safetyKindMeta(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/safetyKinds.test.ts`
Esperado: FAIL — `SAFETY_KINDS` não existe.

- [ ] **Step 3: Implementar**

```ts
export interface SafetyKind {
  value:
    | "lost_time_injury" | "reportable_accident" | "first_aid" | "near_miss"
    | "safety_observation" | "toolbox_talk" | "ppe_breach";
  label: string;
  /**
   * What sort of fact this is, and the reason the three are never added together:
   *   harm       — it already hurt somebody
   *   signal     — it did not hurt anybody, and reporting it is the good outcome
   *   prevention — activity done on purpose, counted against a weekly minimum
   */
  group: "harm" | "signal" | "prevention";
  /** Tailwind classes for a badge. */
  badge: string;
}

export const SAFETY_KINDS: SafetyKind[] = [
  { value: "lost_time_injury",   label: "Lost-time injury",   group: "harm",       badge: "bg-destructive/15 text-destructive-strong border-destructive/40" },
  { value: "reportable_accident", label: "Reportable accident", group: "harm",      badge: "bg-destructive/15 text-destructive-strong border-destructive/40" },
  { value: "first_aid",          label: "First aid",          group: "harm",       badge: "bg-warning/15 text-warning-strong border-warning/40" },
  { value: "near_miss",          label: "Near miss",          group: "signal",     badge: "bg-primary/15 text-primary border-primary/40" },
  { value: "safety_observation", label: "Safety observation", group: "prevention", badge: "bg-muted text-muted-foreground border-border" },
  { value: "toolbox_talk",       label: "Toolbox talk",       group: "prevention", badge: "bg-muted text-muted-foreground border-border" },
  { value: "ppe_breach",         label: "PPE breach",         group: "signal",     badge: "bg-warning/15 text-warning-strong border-warning/40" },
];

export function safetyKindMeta(value: string | null | undefined): SafetyKind | null {
  return SAFETY_KINDS.find((k) => k.value === value) ?? null;
}
```

- [ ] **Step 4: Correr e commitar**

```bash
npm run test -- src/__tests__/safetyKinds.test.ts && npm run typecheck
git add src/lib/qualityConstants.ts src/__tests__/safetyKinds.test.ts
git commit -m "A near miss and a first aid case are different facts"
```

---

### Task 4: O selector de domínio na página

**Files:**
- Modify: `src/pages/dashboard/QualityActionsPage.tsx`
- Modify: `src/hooks/useQualityActions.ts` (o `select` passa a trazer `domain, safety_kind`)
- Test: `src/__tests__/domainFilter.test.ts`
- Create: `src/lib/actionDomain.ts`

**Interfaces:**
- Consumes: `SAFETY_KINDS` (Task 3).
- Produces: `type ActionDomainFilter = "quality" | "safety" | "all"`; `filterByDomain(actions, filter)`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import { filterByDomain } from "@/lib/actionDomain";

const q = { id: "1", domain: "quality" };
const s = { id: "2", domain: "safety" };
const old = { id: "3" }; // gravada antes da coluna existir

describe("filterByDomain", () => {
  it("shows only what the tab is about", () => {
    expect(filterByDomain([q, s], "quality").map((a) => a.id)).toEqual(["1"]);
    expect(filterByDomain([q, s], "safety").map((a) => a.id)).toEqual(["2"]);
  });

  it("shows both under All", () => {
    expect(filterByDomain([q, s], "all")).toHaveLength(2);
  });

  it("reads a row with no domain as quality, so nothing already logged disappears", () => {
    expect(filterByDomain([old], "quality").map((a) => a.id)).toEqual(["3"]);
    expect(filterByDomain([old], "safety")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/domainFilter.test.ts`
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
export type ActionDomainFilter = "quality" | "safety" | "all";

/**
 * A row written before the `domain` column existed is quality — that is what the
 * column's default says, and reading it any other way would make the whole existing
 * log vanish from its own tab.
 */
export function domainOf(action: { domain?: string | null }): "quality" | "safety" {
  return action.domain === "safety" ? "safety" : "quality";
}

export function filterByDomain<T extends { domain?: string | null }>(
  actions: T[],
  filter: ActionDomainFilter,
): T[] {
  return filter === "all" ? actions : actions.filter((a) => domainOf(a) === filter);
}
```

- [ ] **Step 4: Ligar à página**

- `useQualityActions` acrescenta `domain, safety_kind` à lista de colunas do `select`.
- A página guarda `const [domainFilter, setDomainFilter] = useState<ActionDomainFilter>("quality")` e desenha um `Tabs` de `@/components/ui/tabs` com Quality · Safety · All, acima do log.
- A lista passa por `filterByDomain(...)` antes de tudo o resto, e o contador do cabeçalho (`Log (17)`) conta a lista já filtrada.

- [ ] **Step 5: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/lib/actionDomain.ts src/hooks/useQualityActions.ts src/pages/dashboard/QualityActionsPage.tsx src/__tests__/domainFilter.test.ts
git commit -m "One log, two tabs"
```

---

### Task 5: O diálogo de registo, para segurança

**Files:**
- Modify: `src/pages/dashboard/QualityActionsPage.tsx`
- Test: `src/__tests__/safetyFormGuard.test.ts`
- Modify: `src/lib/actionDomain.ts`

**Interfaces:**
- Produces: `safetyFormBlockers(form): string[]` — o que falta antes de gravar uma ocorrência de segurança.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import { safetyFormBlockers } from "@/lib/actionDomain";

const empty = { domain: "safety", safety_kind: "", leader_name: "", line: "" };

describe("safetyFormBlockers", () => {
  it("names what a safety occurrence cannot be recorded without", () => {
    // Sem lider e sem linha a ocorrencia nao pode ser contada por nenhum dos dois, e uma
    // contagem que descarta linhas em silencio e a armadilha que este modelo evita.
    expect(safetyFormBlockers(empty)).toEqual(["Kind", "Leader", "Line"]);
  });

  it("clears once all three are given", () => {
    expect(safetyFormBlockers({ ...empty, safety_kind: "near_miss", leader_name: "X", line: "Line 5" })).toEqual([]);
  });

  it("blocks nothing on a quality action, whose rules did not change", () => {
    expect(safetyFormBlockers({ domain: "quality", safety_kind: "", leader_name: "", line: "" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/safetyFormGuard.test.ts`
Esperado: FAIL.

- [ ] **Step 3: Implementar**

```ts
/**
 * What a safety occurrence cannot be saved without.
 *
 * Leader and line stay nullable in the table — tightening them would reject quality rows
 * that already exist — so the requirement lives here, on the way in. A safety row
 * missing either cannot be counted per leader or per line, and the weekly counts would
 * drop it without saying so.
 */
export function safetyFormBlockers(form: {
  domain?: string | null; safety_kind?: string | null;
  leader_name?: string | null; line?: string | null;
}): string[] {
  if (form.domain !== "safety") return [];
  const missing: string[] = [];
  if (!form.safety_kind) missing.push("Kind");
  if (!form.leader_name) missing.push("Leader");
  if (!form.line) missing.push("Line");
  return missing;
}
```

- [ ] **Step 4: Ligar ao diálogo**

- `makeEmptyForm()` ganha `domain` (o do separador activo) e `safety_kind: ""`.
- Quando `domain === "safety"`, o bloco Severity/Points é substituído por um select **Kind** com os `SAFETY_KINDS` — agrupados por `group`, com um separador entre `harm` e `signal`, para que primeiros socorros e quase-acidentes nunca apareçam lado a lado como se fossem a mesma coisa — mais o select de severidade, sem a caixa de Points (que seria sempre 0).
- O botão de gravar fica desactivado enquanto `safetyFormBlockers(form)` não vier vazio, com os nomes em falta por baixo.
- Ao gravar uma linha de qualidade, `safety_kind` vai `null`; ao gravar segurança, vai o valor — o `CHECK` da Task 1 recusa qualquer outra combinação.

- [ ] **Step 5: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/lib/actionDomain.ts src/pages/dashboard/QualityActionsPage.tsx src/__tests__/safetyFormGuard.test.ts
git commit -m "A safety occurrence needs a kind, a leader and a line"
```

---

### Task 6: A tabela troca Points por Kind

**Files:**
- Modify: `src/pages/dashboard/QualityActionsPage.tsx`

- [ ] **Step 1: Implementar**

No separador Safety, a coluna **Points** é substituída por **Kind**, com o crachá de `safetyKindMeta(...)`. Uma coluna de zeros ensina a ler mal: quem a visse concluiria que a ocorrência não valeu nada, quando o que se passa é que segurança não se mede assim.

No separador All, ambas as colunas existem e a de Points mostra `—` nas linhas de segurança — o traço que o resto do módulo já usa para "não se aplica", nunca `0`.

- [ ] **Step 2: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/pages/dashboard/QualityActionsPage.tsx
git commit -m "Safety has a kind where quality has a price"
```

---

### Task 7: As contagens semanais que o scorecard vai ler

**Files:**
- Create: `supabase/migrations/20260817093000_the_week_counts_its_own_safety.sql`

**Interfaces:**
- Produces: `scorecard_safety_counts(_leader_id uuid, _line text, _week_ending date)` → `TABLE(lost_time_injuries int, reportable_accidents int, first_aid_cases int, near_misses_reported int, safety_observations_done int, toolbox_talks_done int, overdue_hs_actions int, rows_missing_attribution int)`.

- [ ] **Step 1: Escrever a migração**

```sql
-- The week counts its own safety.
--
-- Seven of the scorecard's nine H&S fields stop being typed and start being counted from
-- the log. The two left out are percentages — PPE and training compliance — and a
-- percentage needs a denominator the log does not have: counting breaches is not the
-- same as knowing how many checks were made.
--
-- `overdue_hs_actions` is the log counting itself: safety actions past their due date
-- and not closed.
CREATE OR REPLACE FUNCTION public.scorecard_safety_counts(
  _leader_id uuid, _line text, _week_ending date)
RETURNS TABLE (
  lost_time_injuries integer, reportable_accidents integer, first_aid_cases integer,
  near_misses_reported integer, safety_observations_done integer,
  toolbox_talks_done integer, overdue_hs_actions integer,
  rows_missing_attribution integer
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH week AS (
    SELECT a.*
    FROM public.quality_actions a
    WHERE a.domain = 'safety'
      -- Rejected at validation means Quality looked and said it did not happen. The
      -- same rule the quality side already applies.
      AND a.validation_status IS DISTINCT FROM 'rejected'
      AND a.recorded_at::date BETWEEN _week_ending - 6 AND _week_ending
  ),
  mine AS (
    SELECT * FROM week WHERE leader_id = _leader_id AND line = _line
  )
  SELECT
    count(*) FILTER (WHERE safety_kind = 'lost_time_injury')::integer,
    count(*) FILTER (WHERE safety_kind = 'reportable_accident')::integer,
    count(*) FILTER (WHERE safety_kind = 'first_aid')::integer,
    -- Reported near misses. NEVER added to first_aid_cases: one is a consequence, the
    -- other is the leading signal, and zero here means under-reporting rather than a
    -- safe week — a reading that lives in the scorecard's H&S rule, not here.
    count(*) FILTER (WHERE safety_kind = 'near_miss')::integer,
    count(*) FILTER (WHERE safety_kind = 'safety_observation')::integer,
    count(*) FILTER (WHERE safety_kind = 'toolbox_talk')::integer,
    (SELECT count(*) FROM mine o
      WHERE o.closed_at IS NULL AND o.due_date IS NOT NULL AND o.due_date < _week_ending)::integer,
    -- Occurrences in this week that name no leader or no line. They cannot be counted
    -- above, and a count that drops rows silently is the failure this module exists to
    -- prevent — so they are reported rather than lost.
    (SELECT count(*) FROM week w WHERE w.leader_id IS NULL OR w.line IS NULL)::integer
  FROM mine;
$$;

REVOKE ALL ON FUNCTION public.scorecard_safety_counts(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scorecard_safety_counts(uuid, text, date) TO authenticated;
```

> **Nota para quem implementa:** confirmar com `\d public.quality_actions` que existe uma coluna de prazo chamada `due_date`. O formulário da qualidade tem um campo `due_date`, mas ele não apareceu na listagem de `types.ts` usada para escrever esta spec. Se o nome for outro, usar o real; se não existir prazo nenhum na tabela, devolver `NULL` em `overdue_hs_actions` e dizê-lo no PR — um número inventado é pior do que um em falta.

- [ ] **Step 2: Verificação**

Não é corrível por um agente (SQL Editor). Registar como não corrida.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260817093000_the_week_counts_its_own_safety.sql
git commit -m "The week counts its own safety"
```

---

## Notas da auto-revisão

1. **A coluna `due_date` não está confirmada.** A Task 7 depende dela e o plano manda verificar antes de correr. É a única suposição de esquema que sobrou.
2. **As Tasks 4, 5 e 6 estão especificadas em prosa na parte de JSX.** O que importa nelas está escrito como exigência — o agrupamento que separa primeiros socorros de quase-acidentes, o traço em vez do zero, o botão bloqueado com os nomes em falta. A marcação segue o padrão já usado na página.
3. **Nada aqui liga as contagens ao scorecard.** A Task 7 cria a função; o ecrã que a lê é o formulário semanal, que ainda não existe (plano de 15/08). Até lá a função é escrita e testável, e não é chamada por ninguém — deliberado, e registado para não parecer esquecimento.
4. **A linha é texto de um lado e uuid do outro, e isso vai doer.** `quality_actions.line`
   guarda o NOME da linha; `leader_weekly_scorecard.line_id` guarda um uuid de
   `public.lines`. A Task 7 assina `_line text` porque é o que o log tem, mas quem ligar
   isto ao scorecard terá de casar nome com id — o mesmo casamento tolerante que
   `scorecard_derived_volume` já faz para o `rag_weekly_entries.line`. Não resolvo aqui
   para não inventar uma terceira convenção; fica registado para ser decidido de uma vez
   quando o formulário semanal for construído.
5. **Três migrações estão agora na fila** por aplicar, mais as duas desta. Ver `docs/pending-migrations-apply.sql`.
