# Ecrã de escrita do Scorecard de Líderes — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao módulo do scorecard semanal um ecrã onde a gestão preenche, submete e aprova a semana de cada líder, substituindo a folha de cálculo.

**Architecture:** Uma página em `/dashboard/leader-scorecard` mostra a semana corrente com uma linha por líder×linha esperada (vinda da atribuição versionada) e abre uma gaveta com o formulário por pilar. O ecrã **não reimplementa nenhuma regra**: grava um rascunho e volta a ler `v_leader_weekly_scorecard`, e o RAG que mostra é o veredicto da base.

**Tech Stack:** React 18, TypeScript, Vite, TanStack Query, shadcn/ui, Tailwind, Supabase (PostgREST + RPC), Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-08-15-leader-scorecard-ui-design.md](../specs/2026-08-15-leader-scorecard-ui-design.md)

## Global Constraints

- **Nenhuma regra de negócio no cliente.** RAG, `quality_fail_type`, `hs_driver` e `rag_driver` vêm sempre de `v_leader_weekly_scorecard`. Um `if` que decida uma banda em TypeScript é motivo para rejeitar a tarefa.
- **Vazio nunca é zero.** Campo por preencher lê-se `—`. `0` só aparece se alguém o escreveu.
- **Assiduidade e atrasos não pontuam.** Aparecem marcados como monitorados e nunca entram num RAG.
- **Ações de permissão:** `scorecard.fill` e `scorecard.approve`, no padrão `domínio.verbo` já usado.
- **Rota:** `/dashboard/leader-scorecard`. Não confundir com `/dashboard/leader/scorecard`, que é o `leader_self_scorecard` e não se toca.
- **Comandos:** `npm run test` (Vitest), `npm run test:e2e` (Playwright), `npm run typecheck`, `npm run lint`. Nunca `npx tsc --noEmit` na raiz — não verifica nada neste repo.
- **Idioma da interface:** inglês, como o resto da app. Os comentários e esta documentação em português.

---

### Task 0: Pré-requisito bloqueante — aplicar a migração do módulo

Não é uma tarefa de código e **não pode ser feita por um agente**: precisa de acesso ao SQL Editor do Supabase. Nada do resto do plano funciona antes disto.

**Files:**
- Aplicar: `supabase/migrations/20260815140000_health_and_safety_is_the_second_gate.sql`
- Verificar com: `supabase/tests/leader_weekly_scorecard_test.sql`

- [ ] **Step 1: Aplicar a migração**

Colar o ficheiro inteiro no SQL Editor do Supabase e executar. Ela cria a tabela se não existir, portanto não é preciso aplicar a v1 antes.

- [ ] **Step 2: Verificar que as regras passam**

Colar `supabase/tests/leader_weekly_scorecard_test.sql` inteiro e executar.
Esperado: uma linha final `ALL TESTS PASSED`. Qualquer falha aborta a nomear o caso, o esperado e o obtido.

- [ ] **Step 3: Confirmar que a base ficou visível ao PostgREST**

```bash
set -a && . ./.env && set +a
curl -s -o /dev/null -w '%{http_code}\n' \
  "$VITE_SUPABASE_URL/rest/v1/leader_weekly_scorecard?select=id&limit=1" \
  -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY"
```

Esperado: `200`. Se vier `404` com `PGRST205`, a migração não foi aplicada.

---

### Task 1: Migração de apoio — origem do volume e as duas funções do ecrã

**Files:**
- Create: `supabase/migrations/20260816090000_the_screen_asks_the_database.sql`
- Modify: `supabase/tests/leader_weekly_scorecard_test.sql` (acrescentar casos no fim, antes do `SELECT 'ALL TESTS PASSED'`)

**Interfaces:**
- Produces: coluna `leader_weekly_scorecard.volume_source` (`'derivado' | 'manual' | NULL`);
  `scorecard_week_board(_week_ending date)` → `TABLE(leader_id uuid, leader_name text, line_id uuid, line_name text, entry_id uuid, state text, volume_rag text, quality_rag text, hs_rag text, overall_rag text, rag_driver text, capa_required boolean)`;
  `scorecard_derived_volume(_line_id uuid, _week_ending date)` → `TABLE(planned_volume integer, actual_volume integer, unplanned_downtime_minutes integer, source_label text)`.

- [ ] **Step 1: Escrever os casos de teste que ainda falham**

Acrescentar a `supabase/tests/leader_weekly_scorecard_test.sql`, antes da linha `SELECT 'ALL TESTS PASSED'`:

```sql
-- =====================================================================
-- O quadro da semana (Task 1)
-- =====================================================================

DO $$
DECLARE r record; _rows bigint;
BEGIN
  -- Uma linha por lider x linha ESPERADA na semana, mesmo sem registo.
  SELECT count(*) INTO _rows FROM public.scorecard_week_board('2026-07-05');
  PERFORM pg_temp.expect('board linhas esperadas', _rows::text, '9');

  -- LIDER_G tem atribuicao e nao preencheu: aparece, e aparece como vazio.
  SELECT * INTO r FROM public.scorecard_week_board('2026-07-05')
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a7';
  PERFORM pg_temp.expect('board por preencher state', r.state, 'por preencher');
  PERFORM pg_temp.expect('board por preencher rag',   r.overall_rag, NULL);

  -- LIDER_C submeteu e foi aprovada nos testes da CAPA.
  SELECT * INTO r FROM public.scorecard_week_board('2026-07-05')
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a3';
  PERFORM pg_temp.expect('board aprovada state',  r.state, 'aprovada');
  PERFORM pg_temp.expect('board aprovada rag',    r.overall_rag, 'Red');
  PERFORM pg_temp.expect('board aprovada capa',   r.capa_required::text, 'true');
END $$;
```

- [ ] **Step 2: Correr para confirmar que falha**

Colar o ficheiro de testes no SQL Editor.
Esperado: `ERROR: function public.scorecard_week_board(unknown) does not exist`.

- [ ] **Step 3: Escrever a migração**

```sql
-- The screen asks the database.
--
-- Two functions and one column, so that the write screen can show what it must without
-- deciding anything. scorecard_week_board answers "who is expected this week, and where
-- did each of them get to" — the question a GROUP BY over the weeks cannot answer,
-- because a leader who recorded nothing has no row to group. scorecard_derived_volume
-- answers "what does production already say about this line this week", so the same
-- number is not typed twice into two modules that will then disagree.

DO $$ BEGIN
  CREATE TYPE public.scorecard_volume_source AS ENUM ('derivado', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.leader_weekly_scorecard
  ADD COLUMN IF NOT EXISTS volume_source public.scorecard_volume_source;

COMMENT ON COLUMN public.leader_weekly_scorecard.volume_source IS
  'De onde veio o volume: derivado da producao ou escrito a mao. NULL enquanto nao houver volume. Existe para que uma correccao manual seja visivel na auditoria em vez de silenciosa.';

-- O estado de uma semana, com a ordem que importa: aprovada vence submetida, submetida
-- vence rascunho, e a ausencia de registo e um estado seu, nao um nulo.
CREATE OR REPLACE FUNCTION public.scorecard_week_board(_week_ending date)
RETURNS TABLE (
  leader_id uuid, leader_name text, line_id uuid, line_name text,
  entry_id uuid, state text,
  volume_rag text, quality_rag text, hs_rag text, overall_rag text,
  rag_driver text, capa_required boolean
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    a.leader_id, ll.name, a.line_id, ln.name,
    w.id,
    CASE
      WHEN w.id IS NULL            THEN 'por preencher'
      WHEN w.approved_at IS NOT NULL THEN 'aprovada'
      WHEN w.submitted_at IS NOT NULL THEN 'submetida'
      ELSE 'rascunho'
    END,
    w.volume_rag, w.quality_rag, w.hs_rag, w.overall_rag,
    w.rag_driver, w.capa_required
  FROM public.leader_line_assignment a
  JOIN public.line_leaders ll ON ll.id = a.leader_id
  JOIN public.lines        ln ON ln.id = a.line_id
  LEFT JOIN public.v_leader_weekly_scorecard w
         ON w.leader_id = a.leader_id
        AND w.line_id   = a.line_id
        AND w.week_ending = _week_ending
  WHERE _week_ending >= a.valid_from
    AND (a.valid_to IS NULL OR _week_ending <= a.valid_to)
  ORDER BY ll.name, ln.name;
$$;

-- O volume que a producao ja registou para aquela linha naquela semana. Duas equipas na
-- mesma linha recebem o MESMO valor: repartir exigiria saber que fraccao da semana coube
-- a cada uma, coisa que ninguem regista, e inventa-la seria pior do que mostrar o total
-- com a origem a vista.
CREATE OR REPLACE FUNCTION public.scorecard_derived_volume(_line_id uuid, _week_ending date)
RETURNS TABLE (
  planned_volume integer, actual_volume integer,
  unplanned_downtime_minutes integer, source_label text
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    NULLIF(sum(e.plan_qty), 0)::integer,
    NULLIF(sum(e.actual_qty), 0)::integer,
    (SELECT sum(d.minutes)::integer FROM public.downtime d
      WHERE d.line_id = _line_id
        AND d.occurred_on BETWEEN _week_ending - 6 AND _week_ending),
    'RAG Weekly'
  FROM public.rag_weekly_entries e
  WHERE e.line_id = _line_id
    AND e.entry_date BETWEEN _week_ending - 6 AND _week_ending;
$$;

REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scorecard_derived_volume(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scorecard_derived_volume(uuid, date) TO authenticated;
```

> **Nota para quem implementa:** os nomes de coluna de `rag_weekly_entries` e `downtime` (`plan_qty`, `actual_qty`, `entry_date`, `line_id`, `minutes`, `occurred_on`) foram lidos do uso em `src/pages/dashboard/RAGWeeklyPage.tsx`, não de uma inspeção da tabela. Confirmar com `\d public.rag_weekly_entries` no SQL Editor antes de correr, e corrigir os nomes se diferirem. Se `downtime` não tiver `minutes`/`occurred_on`, devolver `NULL` nessa coluna e registar no PR — um derivado errado é pior do que nenhum.

- [ ] **Step 4: Correr os testes SQL outra vez**

Esperado: `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260816090000_the_screen_asks_the_database.sql supabase/tests/leader_weekly_scorecard_test.sql
git commit -m "The screen asks the database"
```

---

### Task 2: As duas ações de permissão

**Files:**
- Modify: `src/lib/permissions.ts` (união `Action`, `MATRIX`, lista de grupos, descrições)
- Test: `src/lib/permissions.test.ts`

**Interfaces:**
- Produces: `Action` passa a incluir `"scorecard.fill"` e `"scorecard.approve"`; `can(role, action)` responde a ambas.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/lib/permissions.test.ts`:

```ts
describe("scorecard actions", () => {
  it("lets the roles that run the weekly review fill a week", () => {
    expect(can("manager", "scorecard.fill")).toBe(true);
    expect(can("quality_supervisor", "scorecard.fill")).toBe(true);
    expect(can("production_office_admin", "scorecard.fill")).toBe(true);
  });

  it("keeps approval narrower than filling", () => {
    // Quem preenche nao aprova por inerencia: aprovar um Fail e um acto de gestao.
    expect(can("production_office_admin", "scorecard.approve")).toBe(false);
    expect(can("manager", "scorecard.approve")).toBe(true);
  });

  it("keeps operators out of both", () => {
    expect(can("operator", "scorecard.fill")).toBe(false);
    expect(can("operator", "scorecard.approve")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/lib/permissions.test.ts`
Esperado: FAIL — `scorecard.fill` não existe no tipo `Action`.

- [ ] **Step 3: Implementar**

Em `src/lib/permissions.ts`, acrescentar à união `Action` (junto de `"rag.view"`):

```ts
  | "scorecard.fill"
  | "scorecard.approve"
```

À `MATRIX`:

```ts
  "scorecard.fill": ["admin", "manager", "quality_supervisor", "production_office_admin"],
  // Mais restrita do que preencher, de proposito: aprovar uma semana com Fail e o
  // controlo que impede uma investigacao de ser dispensada por quem a devia fazer.
  "scorecard.approve": ["admin", "manager", "quality_supervisor"],
```

À lista de grupos (junto da entrada `rag`):

```ts
  { key: "scorecard", label: "Leader Scorecard", actions: ["scorecard.fill", "scorecard.approve"] },
```

Às descrições:

```ts
  "scorecard.fill": "Fill in and submit a leader's weekly scorecard.",
  "scorecard.approve": "Approve a submitted week, including one carrying a CAPA.",
```

- [ ] **Step 4: Correr os testes**

Run: `npm run test -- src/lib/permissions.test.ts && npm run typecheck`
Esperado: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "Filling a week and approving one are different rights"
```

---

### Task 3: O hook do quadro da semana

**Files:**
- Create: `src/hooks/useScorecardWeek.ts`
- Test: `src/__tests__/scorecardWeek.test.ts`
- Create: `src/lib/scorecardWeek.ts` (funções puras, testáveis sem rede)

**Interfaces:**
- Consumes: `scorecard_week_board` (Task 1).
- Produces: `type ScorecardBoardRow`; `weekEndingFor(date: Date): string`; `boardCounts(rows: ScorecardBoardRow[]): { toFill: number; toApprove: number; capasOpen: number }`; `useScorecardWeek(weekEnding: string)`.

- [ ] **Step 1: Escrever o teste que falha**

`src/__tests__/scorecardWeek.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boardCounts, weekEndingFor, type ScorecardBoardRow } from "@/lib/scorecardWeek";

const row = (over: Partial<ScorecardBoardRow>): ScorecardBoardRow => ({
  leader_id: "l", leader_name: "LIDER", line_id: "n", line_name: "LINHA",
  entry_id: null, state: "por preencher",
  volume_rag: null, quality_rag: null, hs_rag: null, overall_rag: null,
  rag_driver: null, capa_required: null, ...over,
});

describe("weekEndingFor", () => {
  it("gives the Sunday that closes the week", () => {
    expect(weekEndingFor(new Date("2026-07-01T10:00:00Z"))).toBe("2026-07-05");
  });

  it("leaves a Sunday where it is", () => {
    expect(weekEndingFor(new Date("2026-07-05T10:00:00Z"))).toBe("2026-07-05");
  });
});

describe("boardCounts", () => {
  it("counts what is still owed", () => {
    const counts = boardCounts([
      row({ state: "por preencher" }),
      row({ state: "submetida" }),
      row({ state: "submetida", capa_required: true }),
      row({ state: "aprovada" }),
    ]);
    expect(counts).toEqual({ toFill: 1, toApprove: 2, capasOpen: 1 });
  });

  it("counts nothing when there is nothing, rather than guessing", () => {
    expect(boardCounts([])).toEqual({ toFill: 0, toApprove: 0, capasOpen: 0 });
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/scorecardWeek.test.ts`
Esperado: FAIL — `Cannot find module '@/lib/scorecardWeek'`.

- [ ] **Step 3: Implementar as funções puras**

`src/lib/scorecardWeek.ts`:

```ts
/** Uma linha do quadro da semana, tal como `scorecard_week_board` a devolve. */
export type ScorecardBoardRow = {
  leader_id: string;
  leader_name: string;
  line_id: string;
  line_name: string;
  /** Null quando a semana ainda nao foi criada. */
  entry_id: string | null;
  state: "por preencher" | "rascunho" | "submetida" | "aprovada";
  volume_rag: string | null;
  quality_rag: string | null;
  hs_rag: string | null;
  overall_rag: string | null;
  rag_driver: string | null;
  capa_required: boolean | null;
};

/** O domingo que fecha a semana de uma data qualquer. */
export function weekEndingFor(d: Date): string {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() + ((7 - out.getUTCDay()) % 7));
  return out.toISOString().slice(0, 10);
}

export function boardCounts(rows: ScorecardBoardRow[]) {
  return {
    toFill: rows.filter((r) => r.state === "por preencher").length,
    toApprove: rows.filter((r) => r.state === "submetida").length,
    capasOpen: rows.filter((r) => r.capa_required === true && r.state !== "aprovada").length,
  };
}
```

- [ ] **Step 4: Correr os testes**

Run: `npm run test -- src/__tests__/scorecardWeek.test.ts`
Esperado: PASS.

- [ ] **Step 5: Escrever o hook**

`src/hooks/useScorecardWeek.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";

export function useScorecardWeek(weekEnding: string) {
  return useQuery({
    queryKey: ["scorecard-week", weekEnding],
    queryFn: async (): Promise<ScorecardBoardRow[]> => {
      const { data, error } = await supabase.rpc("scorecard_week_board", {
        _week_ending: weekEnding,
      });
      if (error) throw error;
      return (data ?? []) as ScorecardBoardRow[];
    },
  });
}
```

- [ ] **Step 6: Verificar tipos e commitar**

```bash
npm run typecheck
git add src/lib/scorecardWeek.ts src/hooks/useScorecardWeek.ts src/__tests__/scorecardWeek.test.ts
git commit -m "The week knows who is missing from it"
```

> Se `npm run typecheck` reclamar que `scorecard_week_board` não existe em `Database["public"]["Functions"]`, é porque `src/integrations/supabase/types.ts` ainda não foi regenerado. Regenerar via Lovable ou anotar o `rpc` com `as never` **não é aceitável** — regenerar os tipos é parte desta tarefa.

---

### Task 4: A página, a rota e a entrada na barra lateral

**Files:**
- Create: `src/pages/dashboard/LeaderScorecardWeekPage.tsx`
- Modify: `src/App.tsx` (import e `<Route>`, junto de `/dashboard/rag-weekly`)
- Modify: `src/components/DashboardLayout.tsx` (entrada de navegação)
- Test: `src/__tests__/navigation.test.ts`

**Interfaces:**
- Consumes: `useScorecardWeek`, `weekEndingFor`, `boardCounts` (Task 3); `scorecard.fill` (Task 2).
- Produces: rota `/dashboard/leader-scorecard`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/__tests__/navigation.test.ts`, seguindo o padrão já usado nesse ficheiro para as outras rotas:

```ts
it("puts the leader scorecard behind scorecard.fill", () => {
  expect(can("manager", "scorecard.fill")).toBe(true);
  expect(can("operator", "scorecard.fill")).toBe(false);
});
```

- [ ] **Step 2: Correr para confirmar que passa ou falha conforme a Task 2**

Run: `npm run test -- src/__tests__/navigation.test.ts`
Esperado: PASS (a Task 2 já o garante). Se falhar, a Task 2 não está completa.

- [ ] **Step 3: Criar a página**

`src/pages/dashboard/LeaderScorecardWeekPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScorecardWeek } from "@/hooks/useScorecardWeek";
import { boardCounts, weekEndingFor } from "@/lib/scorecardWeek";
import { ScorecardWeekBoard } from "@/components/scorecard/ScorecardWeekBoard";

export default function LeaderScorecardWeekPage() {
  const [weekEnding, setWeekEnding] = useState(() => weekEndingFor(new Date()));
  const { data: rows, isLoading } = useScorecardWeek(weekEnding);
  const counts = useMemo(() => boardCounts(rows ?? []), [rows]);

  const shiftWeek = (days: number) => {
    const d = new Date(`${weekEnding}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setWeekEnding(weekEndingFor(d));
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Leader scorecard</h1>
          <p className="text-sm text-muted-foreground">Week ending {weekEnding}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => shiftWeek(-7)}>Previous week</Button>
          <Button variant="outline" onClick={() => shiftWeek(7)}>Next week</Button>
        </div>
      </header>

      <ScorecardWeekBoard rows={rows ?? []} isLoading={isLoading} />

      <footer className="text-sm text-muted-foreground">
        {counts.toFill} to fill · {counts.toApprove} to approve · {counts.capasOpen} CAPA open
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Ligar a rota**

Em `src/App.tsx`, imediatamente a seguir ao bloco de `/dashboard/rag-weekly`:

```tsx
<Route
  path="/dashboard/leader-scorecard"
  element={
    <ProtectedRoute allowedRoles={["admin", "manager", "quality_supervisor", "production_office_admin"]} requiredAction="scorecard.fill">
      <LeaderScorecardWeekPage />
    </ProtectedRoute>
  }
/>
```

E o import, no mesmo estilo dos outros da página.

- [ ] **Step 5: Ligar a navegação**

Em `src/components/DashboardLayout.tsx`, acrescentar uma entrada junto da do RAG Weekly, com o mesmo padrão de `can(role, action)` que as outras usam: rótulo `Leader scorecard`, destino `/dashboard/leader-scorecard`, ação `scorecard.fill`.

- [ ] **Step 6: Correr tudo e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/pages/dashboard/LeaderScorecardWeekPage.tsx src/App.tsx src/components/DashboardLayout.tsx src/__tests__/navigation.test.ts
git commit -m "A page for the week"
```

---

### Task 5: O quadro da semana

**Files:**
- Create: `src/components/scorecard/ScorecardWeekBoard.tsx`
- Create: `src/components/scorecard/RagChip.tsx`
- Test: `src/__tests__/ragChip.test.ts`

**Interfaces:**
- Consumes: `ScorecardBoardRow` (Task 3).
- Produces: `<ScorecardWeekBoard rows onOpen? isLoading />`; `<RagChip value={string | null} />`; `ragLabel(value: string | null): string`.

- [ ] **Step 1: Escrever o teste que falha**

`src/__tests__/ragChip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ragLabel } from "@/components/scorecard/RagChip";

describe("ragLabel", () => {
  it("shows a dash for what was never recorded, never a zero and never a colour", () => {
    expect(ragLabel(null)).toBe("—");
  });

  it("passes through the verdict the database gave", () => {
    expect(ragLabel("Red")).toBe("Red");
    expect(ragLabel("Sem dados")).toBe("Sem dados");
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/ragChip.test.ts`
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o chip**

`src/components/scorecard/RagChip.tsx`:

```tsx
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
```

- [ ] **Step 4: Implementar o quadro**

`src/components/scorecard/ScorecardWeekBoard.tsx`:

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";
import { RagChip } from "./RagChip";

type Props = {
  rows: ScorecardBoardRow[];
  isLoading?: boolean;
  onOpen?: (row: ScorecardBoardRow) => void;
};

export function ScorecardWeekBoard({ rows, isLoading, onOpen }: Props) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the week…</p>;

  // Sem atribuicao nao ha quadro, e isso nao e um erro: e uma coisa por configurar.
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed p-6 text-sm text-muted-foreground">
        No leader is assigned to a line for this week. Set the assignments first — the
        board is built from them, not from what happens to have been typed in.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Leader</TableHead>
            <TableHead>Line</TableHead>
            <TableHead>Volume</TableHead>
            <TableHead>Quality</TableHead>
            <TableHead>H&amp;S</TableHead>
            <TableHead>Overall</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={`${r.leader_id}-${r.line_id}`}
              className="cursor-pointer"
              onClick={() => onOpen?.(r)}
            >
              <TableCell className="font-medium">{r.leader_name}</TableCell>
              <TableCell>{r.line_name}</TableCell>
              <TableCell><RagChip value={r.volume_rag} /></TableCell>
              <TableCell><RagChip value={r.quality_rag} /></TableCell>
              <TableCell><RagChip value={r.hs_rag} /></TableCell>
              <TableCell><RagChip value={r.overall_rag} /></TableCell>
              <TableCell className="text-sm text-muted-foreground">{r.state}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5: Correr e commitar**

```bash
npm run test && npm run typecheck
git add src/components/scorecard src/__tests__/ragChip.test.ts
git commit -m "The board shows who is missing"
```

---

### Task 6: Ler e gravar uma semana, com o veredicto vindo da base

**Files:**
- Create: `src/hooks/useScorecardEntry.ts`
- Test: `src/__tests__/scorecardEntry.test.ts`
- Create: `src/lib/scorecardEntry.ts`

**Interfaces:**
- Produces: `type ScorecardEntryDraft` (os campos escrevíveis); `type ScorecardEntryVerdict` (os campos calculados); `emptyDraft(leaderId, lineId, weekEnding): ScorecardEntryDraft`; `isBlank(v): boolean`; `useScorecardEntry(leaderId, lineId, weekEnding)` → `{ draft: ScorecardEntryDraft, verdict: ScorecardEntryVerdict | null, setField, saveNow(fields): Promise<void>, isSaving: boolean }`.

> `saveNow` é o que a Task 12 usa para carimbar `submitted_by` / `approved_by`: grava imediatamente, sem esperar pelo _debounce_. Não há `submit()` nem `approve()` no hook — quem sabe o que é submeter e o que é aprovar é a gaveta, não o acesso a dados.

- [ ] **Step 1: Escrever o teste que falha**

`src/__tests__/scorecardEntry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyDraft, isBlank } from "@/lib/scorecardEntry";

describe("isBlank", () => {
  it("separates nothing recorded from a recorded zero", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    // Zero near-misses e um numero que alguem escreveu. Nao e uma lacuna.
    expect(isBlank(0)).toBe(false);
  });
});

describe("emptyDraft", () => {
  it("starts every measured field unrecorded, not at zero", () => {
    const d = emptyDraft("l1", "n1", "2026-07-05");
    expect(d.near_misses_reported).toBeNull();
    expect(d.planned_volume).toBeNull();
    expect(d.ccp_check_status).toBeNull();
    expect(d.leader_id).toBe("l1");
    expect(d.week_ending).toBe("2026-07-05");
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/scorecardEntry.test.ts`
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`src/lib/scorecardEntry.ts`:

```ts
export type CheckStatus = "Pass" | "Fail" | "Not Done";

/** So os campos que alguem escreve. Nada calculado entra aqui. */
export type ScorecardEntryDraft = {
  leader_id: string;
  line_id: string;
  week_ending: string;
  planned_volume: number | null;
  actual_volume: number | null;
  unplanned_downtime_minutes: number | null;
  downtime_reason: string | null;
  volume_source: "derivado" | "manual" | null;
  ccp_check_status: CheckStatus | null;
  starter_check_status: CheckStatus | null;
  volume_weight_check_status: CheckStatus | null;
  lost_time_injuries: number | null;
  reportable_accidents: number | null;
  first_aid_cases: number | null;
  near_misses_reported: number | null;
  safety_observations_done: number | null;
  toolbox_talks_done: number | null;
  ppe_compliance_pct: number | null;
  hs_training_compliance_pct: number | null;
  overdue_hs_actions: number | null;
  leader_attendance_pct: number | null;
  team_attendance_pct: number | null;
  leader_lateness_incidents: number | null;
  team_lateness_incidents: number | null;
  root_cause: string | null;
  corrective_action: string | null;
  capa_owner: string | null;
  capa_due_date: string | null;
  capa_status: string | null;
};

/** So os campos que a base calcula. O ecra le-os e nunca os produz. */
export type ScorecardEntryVerdict = {
  volume_pct: number | null;
  volume_pct_adjusted: number | null;
  volume_rag: string | null;
  quality_rag: string | null;
  quality_fail_type: string | null;
  capa_required: boolean | null;
  hs_rag: string | null;
  hs_driver: string[] | null;
  overall_rag: string | null;
  rag_driver: string | null;
};

/** Vazio nao e zero: um campo por preencher fica nulo e le-se "—". */
export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function emptyDraft(leader_id: string, line_id: string, week_ending: string): ScorecardEntryDraft {
  return {
    leader_id, line_id, week_ending,
    planned_volume: null, actual_volume: null, unplanned_downtime_minutes: null,
    downtime_reason: null, volume_source: null,
    ccp_check_status: null, starter_check_status: null, volume_weight_check_status: null,
    lost_time_injuries: null, reportable_accidents: null, first_aid_cases: null,
    near_misses_reported: null, safety_observations_done: null, toolbox_talks_done: null,
    ppe_compliance_pct: null, hs_training_compliance_pct: null, overdue_hs_actions: null,
    leader_attendance_pct: null, team_attendance_pct: null,
    leader_lateness_incidents: null, team_lateness_incidents: null,
    root_cause: null, corrective_action: null, capa_owner: null,
    capa_due_date: null, capa_status: null,
  };
}
```

- [ ] **Step 4: Escrever o hook**

`src/hooks/useScorecardEntry.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { emptyDraft, type ScorecardEntryDraft, type ScorecardEntryVerdict } from "@/lib/scorecardEntry";

export function useScorecardEntry(leaderId: string, lineId: string, weekEnding: string) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ScorecardEntryDraft>(() => emptyDraft(leaderId, lineId, weekEnding));
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // O veredicto vem sempre da view. O ecra nunca o calcula.
  const verdict = useQuery({
    queryKey: ["scorecard-entry", leaderId, lineId, weekEnding],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_leader_weekly_scorecard")
        .select("*")
        .eq("leader_id", leaderId).eq("line_id", lineId).eq("week_ending", weekEnding)
        .maybeSingle();
      if (error) throw error;
      if (data) setDraft((d) => ({ ...d, ...data } as ScorecardEntryDraft));
      return (data ?? null) as (ScorecardEntryVerdict & { id: string }) | null;
    },
  });

  const save = useMutation({
    mutationFn: async (next: ScorecardEntryDraft) => {
      const { error } = await supabase
        .from("leader_weekly_scorecard")
        .upsert(next, { onConflict: "leader_id,line_id,week_ending" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scorecard-entry", leaderId, lineId, weekEnding] });
      qc.invalidateQueries({ queryKey: ["scorecard-week", weekEnding] });
    },
    // A base e que manda: a mensagem do trigger da CAPA aparece tal como ela a escreveu.
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const setField = useCallback(<K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save.mutate(next), 400);
      return next;
    });
  }, [save]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * Grava ja, sem esperar pelo debounce. E o que submeter e aprovar usam: um carimbo de
   * auditoria nao pode ficar 400 ms pendurado num temporizador que a gaveta a fechar
   * cancela.
   */
  const saveNow = useCallback(async (fields: Partial<ScorecardEntryDraft>) => {
    clearTimeout(timer.current);
    const next = { ...draft, ...fields };
    setDraft(next);
    await save.mutateAsync(next);
  }, [draft, save]);

  return { draft, setField, saveNow, verdict: verdict.data ?? null, isSaving: save.isPending };
}
```

- [ ] **Step 5: Correr e commitar**

```bash
npm run test && npm run typecheck
git add src/lib/scorecardEntry.ts src/hooks/useScorecardEntry.ts src/__tests__/scorecardEntry.test.ts
git commit -m "The screen writes, the database judges"
```

---

### Task 7: A gaveta e o veredicto

**Files:**
- Create: `src/components/scorecard/ScorecardEntryDrawer.tsx`
- Create: `src/components/scorecard/ScorecardVerdict.tsx`
- Modify: `src/pages/dashboard/LeaderScorecardWeekPage.tsx` (estado da linha aberta)

**Interfaces:**
- Consumes: `useScorecardEntry` (Task 6), `RagChip` (Task 5).
- Produces: `<ScorecardEntryDrawer row onClose />`, `<ScorecardVerdict verdict />`.

- [ ] **Step 1: Implementar o veredicto**

`src/components/scorecard/ScorecardVerdict.tsx`:

```tsx
import type { ScorecardEntryVerdict } from "@/lib/scorecardEntry";
import { RagChip } from "./RagChip";

export function ScorecardVerdict({ verdict }: { verdict: ScorecardEntryVerdict | null }) {
  return (
    <section className="rounded border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Result</span>
        <RagChip value={verdict?.overall_rag ?? null} />
      </div>
      {verdict?.rag_driver && (
        <p className="mt-2 text-sm text-muted-foreground">{verdict.rag_driver}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Implementar a gaveta**

`src/components/scorecard/ScorecardEntryDrawer.tsx`, com `Sheet` de `@/components/ui/sheet`, montando por ordem: `VolumePillar`, `QualityPillar`, `HealthSafetyPillar`, `MonitoredPillar`, `ScorecardVerdict`, `CapaBlock`. Nas Tasks 8 a 12 cada faixa é acrescentada; nesta tarefa a gaveta abre com o `ScorecardVerdict` e um cabeçalho com líder, linha e semana.

- [ ] **Step 3: Ligar à página**

Guardar `const [open, setOpen] = useState<ScorecardBoardRow | null>(null)` e passar `onOpen={setOpen}` ao `ScorecardWeekBoard`.

- [ ] **Step 4: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/components/scorecard src/pages/dashboard/LeaderScorecardWeekPage.tsx
git commit -m "A drawer that shows the verdict"
```

---

### Task 8: Faixa do volume, com origem derivada

**Files:**
- Create: `src/components/scorecard/pillars/VolumePillar.tsx`
- Create: `src/hooks/useDerivedVolume.ts`
- Test: `src/__tests__/derivedVolume.test.ts`
- Create: `src/lib/derivedVolume.ts`

**Interfaces:**
- Consumes: `scorecard_derived_volume` (Task 1), `setField` (Task 6).
- Produces: `sourceFor(typed, derived): "derivado" | "manual" | null`.

- [ ] **Step 1: Escrever o teste que falha**

`src/__tests__/derivedVolume.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sourceFor } from "@/lib/derivedVolume";

describe("sourceFor", () => {
  it("stays derived while the number is the one production gave", () => {
    expect(sourceFor(1000, 1000)).toBe("derivado");
  });

  it("becomes manual the moment somebody changes it", () => {
    expect(sourceFor(1050, 1000)).toBe("manual");
  });

  it("is manual when production had nothing to offer", () => {
    expect(sourceFor(1000, null)).toBe("manual");
  });

  it("is nothing at all while the field is empty", () => {
    expect(sourceFor(null, 1000)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/derivedVolume.test.ts`
Esperado: FAIL.

- [ ] **Step 3: Implementar**

`src/lib/derivedVolume.ts`:

```ts
export type DerivedVolume = {
  planned_volume: number | null;
  actual_volume: number | null;
  unplanned_downtime_minutes: number | null;
  source_label: string | null;
};

/**
 * Marca a origem do numero gravado. Existe para que uma correccao a mao seja visivel na
 * auditoria: sem isto, um valor corrigido e um valor derivado sao indistinguiveis.
 */
export function sourceFor(typed: number | null, derived: number | null): "derivado" | "manual" | null {
  if (typed === null) return null;
  return typed === derived ? "derivado" : "manual";
}
```

`src/hooks/useDerivedVolume.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DerivedVolume } from "@/lib/derivedVolume";

export function useDerivedVolume(lineId: string | null, weekEnding: string) {
  return useQuery({
    queryKey: ["scorecard-derived-volume", lineId, weekEnding],
    enabled: Boolean(lineId),
    queryFn: async (): Promise<DerivedVolume | null> => {
      const { data, error } = await supabase.rpc("scorecard_derived_volume", {
        _line_id: lineId, _week_ending: weekEnding,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as DerivedVolume | null;
    },
  });
}
```

- [ ] **Step 4: Implementar a faixa**

`src/components/scorecard/pillars/VolumePillar.tsx`: três campos numéricos (plan, actual, downtime) e um select de razão. Cada campo mostra, por baixo, `From {source_label}` quando o valor coincide com o derivado, e `Changed from {derived}` quando não coincide. Ao gravar, `setField("volume_source", sourceFor(typed, derived))`. Os campos entram vazios se o derivado for nulo — nunca a zero.

- [ ] **Step 5: Correr e commitar**

```bash
npm run test && npm run typecheck
git add src/lib/derivedVolume.ts src/hooks/useDerivedVolume.ts src/components/scorecard/pillars/VolumePillar.tsx src/__tests__/derivedVolume.test.ts
git commit -m "The volume comes from production, and says so"
```

---

### Task 9: Faixa da qualidade

**Files:**
- Create: `src/components/scorecard/pillars/QualityPillar.tsx`

**Interfaces:**
- Consumes: `setField`, `verdict.quality_fail_type` (Task 6).

- [ ] **Step 1: Implementar**

Três grupos de rádio, um por check, com as três opções `Pass` / `Fail` / `Not Done` e nenhuma pré-selecionada — um check por registar não é um check que passou. Por baixo, quando o veredicto do servidor traz `quality_fail_type`, mostrar `Fail — a CAPA is required` ou `Not Done — no product deviation to investigate`.

O componente não decide qual dos dois é: lê `verdict.quality_fail_type`.

- [ ] **Step 2: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/components/scorecard/pillars/QualityPillar.tsx
git commit -m "Fail and Not Done are not the same failure"
```

---

### Task 10: Faixa de Health & Safety

**Files:**
- Create: `src/components/scorecard/pillars/HealthSafetyPillar.tsx`

- [ ] **Step 1: Implementar**

Nove campos, todos a começar vazios. Dois detalhes que são o conteúdo e não decoração:

- junto de `near_misses_reported`, a legenda `Reporting a near miss is the good outcome. Zero reported reads as under-reporting.` — sem isto, quem preenche vai tentar baixar o número;
- `first_aid_cases` e `near_misses_reported` ficam visualmente separados, porque um é consequência e o outro é sinal antecedente, e somá-los é o erro clássico.

Por baixo da faixa, listar `verdict.hs_driver` — as condições que dispararam, todas, vindas do servidor.

- [ ] **Step 2: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/components/scorecard/pillars/HealthSafetyPillar.tsx
git commit -m "Zero near misses is not a clean week"
```

---

### Task 11: Faixa do monitorado

**Files:**
- Create: `src/components/scorecard/pillars/MonitoredPillar.tsx`

- [ ] **Step 1: Implementar**

Quatro campos, dentro de um bloco com o rótulo visível `Monitored — does not score`, com fundo neutro e sem qualquer chip de RAG. Nenhum destes valores toca num veredicto.

Comentário no topo do ficheiro, para quem vier a seguir:

```tsx
/**
 * Assiduidade e atrasos: recolhidos, exibidos, agregados — e sem peso nenhum. Se um dia
 * voltarem a pontuar, tem de ser como pilar proprio, com peso explicito. Nao os diluir
 * dentro de Health & Safety: um atraso nao e um acidente.
 */
```

- [ ] **Step 2: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/components/scorecard/pillars/MonitoredPillar.tsx
git commit -m "Monitored, and scoring nothing"
```

---

### Task 12: CAPA, submissão e aprovação

**Files:**
- Create: `src/components/scorecard/CapaBlock.tsx`
- Test: `src/__tests__/capaGate.test.ts`
- Create: `src/lib/capaGate.ts`
- Modify: `src/components/scorecard/ScorecardEntryDrawer.tsx`

**Interfaces:**
- Produces: `approvalBlockers(draft, verdict): string[]`.

- [ ] **Step 1: Escrever o teste que falha**

`src/__tests__/capaGate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { approvalBlockers } from "@/lib/capaGate";
import { emptyDraft } from "@/lib/scorecardEntry";

const draft = emptyDraft("l", "n", "2026-07-05");

describe("approvalBlockers", () => {
  it("names every missing CAPA field when the week carries a Fail", () => {
    const blockers = approvalBlockers(draft, { quality_fail_type: "Fail" });
    expect(blockers).toEqual(["Root cause", "Corrective action", "CAPA owner", "CAPA due date"]);
  });

  it("blocks nothing on a Not Done, which has no product deviation to investigate", () => {
    expect(approvalBlockers(draft, { quality_fail_type: "Not Done" })).toEqual([]);
  });

  it("clears once the investigation is written down", () => {
    const filled = { ...draft, root_cause: "x", corrective_action: "y", capa_owner: "z", capa_due_date: "2026-07-31" };
    expect(approvalBlockers(filled, { quality_fail_type: "Fail" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `npm run test -- src/__tests__/capaGate.test.ts`
Esperado: FAIL.

- [ ] **Step 3: Implementar**

`src/lib/capaGate.ts`:

```ts
import { isBlank, type ScorecardEntryDraft } from "./scorecardEntry";

/**
 * O espelho de trg_scorecard_require_capa, e apenas isso: serve para dizer a quem
 * preenche o que falta, ANTES de a base recusar. Quem manda continua a ser o trigger; se
 * os dois discordarem, o trigger e que esta certo.
 */
export function approvalBlockers(
  draft: ScorecardEntryDraft,
  verdict: { quality_fail_type: string | null } | null,
): string[] {
  if (verdict?.quality_fail_type !== "Fail") return [];
  const missing: string[] = [];
  if (isBlank(draft.root_cause)) missing.push("Root cause");
  if (isBlank(draft.corrective_action)) missing.push("Corrective action");
  if (isBlank(draft.capa_owner)) missing.push("CAPA owner");
  if (isBlank(draft.capa_due_date)) missing.push("CAPA due date");
  return missing;
}
```

- [ ] **Step 4: Implementar o bloco e os dois botões**

`CapaBlock.tsx`: aparece quando `verdict.quality_fail_type === "Fail"`, com causa, ação, dono, data e estado.

Na gaveta, dois botões:
- **Submit** — grava `submitted_by` (do `supabase.auth.getUser()`) e `submitted_at`.
- **Approve** — visível só com `can(role, "scorecard.approve")`; desativado enquanto `approvalBlockers(...)` não vier vazio, com os nomes em falta a aparecer por baixo do botão. Grava `approved_by` e `approved_at`.

Se ainda assim a base recusar, o `onError` do Task 6 já mostra a mensagem do trigger.

- [ ] **Step 5: Correr e commitar**

```bash
npm run test && npm run typecheck && npm run lint
git add src/lib/capaGate.ts src/components/scorecard src/__tests__/capaGate.test.ts
git commit -m "A Fail cannot be approved without its investigation"
```

---

### Task 13: O ciclo completo, ponta a ponta

**Files:**
- Create: `e2e/leader-scorecard-week.spec.ts`

> Nome distinto de `e2e/leader-scorecard.spec.ts`, que cobre o `leader_self_scorecard`.

- [ ] **Step 1: Escrever o teste**

```ts
import { expect, test } from "@playwright/test";

test.describe("leader scorecard week", () => {
  test("fills, submits and approves a week", async ({ page }) => {
    await page.goto("/dashboard/leader-scorecard");
    await expect(page.getByRole("heading", { name: "Leader scorecard" })).toBeVisible();

    await page.getByRole("row").filter({ hasText: "por preencher" }).first().click();
    await page.getByLabel("CCP check").getByRole("radio", { name: "Pass" }).check();
    await page.getByLabel("Starter check").getByRole("radio", { name: "Pass" }).check();
    await page.getByLabel("Volume & weight check").getByRole("radio", { name: "Pass" }).check();

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("submetida")).toBeVisible();
  });

  test("refuses to approve a Fail without its CAPA", async ({ page }) => {
    await page.goto("/dashboard/leader-scorecard");
    await page.getByRole("row").filter({ hasText: "por preencher" }).first().click();
    await page.getByLabel("CCP check").getByRole("radio", { name: "Fail" }).check();

    const approve = page.getByRole("button", { name: "Approve" });
    await expect(approve).toBeDisabled();
    await expect(page.getByText("Root cause")).toBeVisible();
  });

  test("never breaks a label mid-word", async ({ page }) => {
    // index.css tem overflow-wrap: anywhere global, que ja produziu "QUALIT Y".
    await page.goto("/dashboard/leader-scorecard");
    for (const label of ["Quality", "Overall", "Monitored — does not score"]) {
      const el = page.getByText(label, { exact: false }).first();
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box?.height).toBeLessThan(60);
    }
  });
});
```

- [ ] **Step 2: Correr**

Run: `npm run test:e2e -- e2e/leader-scorecard-week.spec.ts`
Esperado: PASS. Precisa de uma sessão autenticada com um papel que tenha `scorecard.fill` e `scorecard.approve`, e de pelo menos uma atribuição em `leader_line_assignment` para a semana corrente — se o quadro vier vazio, o teste falha no primeiro `.click()` e a causa é falta de atribuição, não um bug do ecrã.

- [ ] **Step 3: Commit**

```bash
git add e2e/leader-scorecard-week.spec.ts
git commit -m "The whole cycle, end to end"
```

---

## Notas da auto-revisão

Três coisas que ficaram por resolver e que quem implementar tem de tratar, em vez de as descobrir tarde:

1. **Nomes de coluna de `rag_weekly_entries` e `downtime`** (Task 1) foram lidos do uso na UI, não da tabela. Confirmar antes de correr a migração.
2. **`src/integrations/supabase/types.ts` tem de ser regenerado** depois das Tasks 0 e 1, ou nada em `supabase.rpc(...)` e `.from("v_leader_weekly_scorecard")` compila. Não contornar com `as never`.
3. **A Task 0 não é executável por um agente.** Se o plano for corrido por subagentes, a Task 0 tem de estar feita antes de começar; nenhuma tarefa seguinte funciona sem ela.
4. **As Tasks 9, 10 e 11 estão especificadas em prosa, não em código.** As três faixas são marcação de formulário repetitiva, e o que nelas importa não é o JSX — é o que cada uma tem de dizer: as três opções sem pré-seleção na qualidade, a legenda do near-miss, a separação entre primeiros socorros e quase-acidentes, e o rótulo "does not score" no monitorado. Essas exigências estão escritas. Quem implementar segue o padrão de formulário já usado em `src/components/headcount` e não inventa um novo.
5. **`saveNow` grava o rascunho inteiro, não um campo.** É um `upsert` da linha completa. Se duas pessoas abrirem a mesma semana ao mesmo tempo, a última a gravar ganha — aceitável nesta fase porque a semana é preenchida por uma pessoa de cada vez, e inaceitável na fase 2, quando a entrada dividida por pilar entrar em cena. Registar como dívida.
