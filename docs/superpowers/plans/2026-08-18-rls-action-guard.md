# Guarda de ações no servidor (piloto `work_orders`) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer com que desligar um switch na matriz de permissões do Admin passe a ser recusado pelo Postgres, e não apenas escondido no ecrã — começando pelas cinco ações de `work_orders`.

**Architecture:** Duas funções SQL (`action_revoked`, `enforce_action`) e cinco triggers `BEFORE` em `public.work_orders`. Nenhuma política RLS existente é alterada. A semântica é só-negar: a base de permissões continua a ser o `MATRIX` do TypeScript, e a tabela `role_permission_overrides` só consegue tirar permissão.

**Tech Stack:** PostgreSQL 15 (Supabase), PostgREST, Vitest para o teste de consistência dos nomes de ação.

**Spec:** `docs/superpowers/specs/2026-08-18-rls-action-guard-design.md`

## Global Constraints

- As migrações deste repositório **não são aplicadas por nada no repo** — quem as aplica é o Lovable. Escrever o ficheiro e commitar não muda a base de dados. Não afirmar que a guarda está ativa sem a prova do SQL editor.
- A ordem do ficheiro de migração é a ordem alfabética do nome. A última migração existente é `20260820090000_filling_a_week_is_not_approving_it.sql`; a nova tem de vir depois.
- Nunca correr `git commit` sem pathspec explícito — há outro processo a mexer no index deste repositório.
- Toda a SQL nova leva `SET search_path = public` e `SECURITY DEFINER` onde lê tabelas com RLS, seguindo o padrão de `has_role` e `current_user_role` (`supabase/migrations/20260627071614_*.sql`).
- Nomes de ação são exatamente os do `MATRIX` em `src/lib/permissions.ts`: `wo.create`, `wo.update`, `wo.delete`, `wo.close`, `wo.force`.
- Valores do enum `wo_status` usados: `closed`, `force_closed`.

---

## File Structure

| Ficheiro | Responsabilidade |
|---|---|
| `supabase/migrations/20260821090000_action_guard_work_orders.sql` (criar) | As duas funções e os cinco triggers, mais o rollback em comentário. |
| `src/__tests__/actionGuard.test.ts` (criar) | Impede que um nome de ação escrito na SQL deixe de existir no `MATRIX` — a única parte verificável nesta máquina. |
| `docs/apply/VERIFY-action-guard.sql` (criar) | A prova, para correr no SQL editor do projeto. |
| `docs/apply/PROMPT-LOVABLE-action-guard.md` (criar) | O texto a dar ao Lovable para aplicar a migração. |

---

### Task 1: A migração, protegida por um teste de nomes

Um nome de ação com um erro de escrita (`wo.delet`) cria um trigger que nunca dispara e que ninguém nota. O teste desta tarefa é a única barreira local contra isso: lê a SQL, extrai os nomes passados a `enforce_action` e exige que todos existam no `MATRIX`.

**Files:**
- Create: `src/__tests__/actionGuard.test.ts`
- Create: `supabase/migrations/20260821090000_action_guard_work_orders.sql`

**Interfaces:**
- Consumes: `ALL_ACTIONS` de `src/lib/permissions.ts:350` (`Action[]`, as 69 chaves do `MATRIX`).
- Produces: as funções SQL `public.action_revoked(text) returns boolean` e `public.enforce_action() returns trigger`, usadas pelos lotes seguintes (downtime, quality, headcount) sem alteração.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/__tests__/actionGuard.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_ACTIONS } from "@/lib/permissions";

const MIGRATION = "supabase/migrations/20260821090000_action_guard_work_orders.sql";

function guardedActions(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  return [...sql.matchAll(/enforce_action\('([^']+)'\)/g)].map((m) => m[1]);
}

describe("guarda de ações em work_orders", () => {
  it("protege as cinco ações de work orders", () => {
    expect(new Set(guardedActions())).toEqual(
      new Set(["wo.create", "wo.update", "wo.delete", "wo.close", "wo.force"]),
    );
  });

  it("não nomeia nenhuma ação que o MATRIX desconheça", () => {
    const desconhecidas = guardedActions().filter(
      (a) => !(ALL_ACTIONS as string[]).includes(a),
    );
    expect(desconhecidas).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr o teste e confirmar que falha**

Run: `npx vitest run src/__tests__/actionGuard.test.ts`
Expected: FAIL — `ENOENT: no such file or directory` no `readFileSync`, porque a migração ainda não existe.

- [ ] **Step 3: Escrever a migração**

Criar `supabase/migrations/20260821090000_action_guard_work_orders.sql`:

```sql
-- A matriz de permissões do Admin escreve em role_permission_overrides, mas
-- nenhuma política RLS a consultava: desligar um switch escondia o botão e
-- deixava a escrita passar. Estes triggers fazem o Postgres recusá-la.
-- Semântica: só negar. A base de quem pode o quê continua no MATRIX (TypeScript).

CREATE OR REPLACE FUNCTION public.action_revoked(_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Sem utilizador (edge functions, pg_cron) nada é negado: um switch do Admin
  -- não pode parar o sync do iTouching nem os fechos noturnos.
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.role_permission_overrides o
    WHERE o.action = _action
      AND o.allowed = false
      AND o.role = public.current_user_role()
  )
$$;

CREATE OR REPLACE FUNCTION public.enforce_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.action_revoked(TG_ARGV[0]) THEN
    RAISE EXCEPTION 'Permission "%" is turned off for your role.', TG_ARGV[0]
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS wo_guard_insert ON public.work_orders;
CREATE TRIGGER wo_guard_insert
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.create');

DROP TRIGGER IF EXISTS wo_guard_update ON public.work_orders;
CREATE TRIGGER wo_guard_update
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.update');

DROP TRIGGER IF EXISTS wo_guard_delete ON public.work_orders;
CREATE TRIGGER wo_guard_delete
  BEFORE DELETE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.delete');

DROP TRIGGER IF EXISTS wo_guard_close ON public.work_orders;
CREATE TRIGGER wo_guard_close
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION public.enforce_action('wo.close');

DROP TRIGGER IF EXISTS wo_guard_force ON public.work_orders;
CREATE TRIGGER wo_guard_force
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.status = 'force_closed' AND OLD.status IS DISTINCT FROM 'force_closed')
  EXECUTE FUNCTION public.enforce_action('wo.force');

-- Rollback:
--   DROP TRIGGER IF EXISTS wo_guard_force  ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_close  ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_delete ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_update ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_insert ON public.work_orders;
--   DROP FUNCTION IF EXISTS public.enforce_action();
--   DROP FUNCTION IF EXISTS public.action_revoked(text);
```

- [ ] **Step 4: Correr o teste e confirmar que passa**

Run: `npx vitest run src/__tests__/actionGuard.test.ts`
Expected: PASS — 2 testes.

- [ ] **Step 5: Confirmar que nada mais partiu**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck sem saída, e a suite completa verde (eram 733 testes nos ficheiros de permissões antes desta tarefa; agora há mais 2).

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/actionGuard.test.ts supabase/migrations/20260821090000_action_guard_work_orders.sql
git commit -m "A permission the database never agreed to withdraw" -- src/__tests__/actionGuard.test.ts supabase/migrations/20260821090000_action_guard_work_orders.sql
```

---

### Task 2: A prova e o pedido de aplicação

A migração não vale nada até correr na base. Esta tarefa entrega o que prova que corre, e o texto que a leva lá.

**Files:**
- Create: `docs/apply/VERIFY-action-guard.sql`
- Create: `docs/apply/PROMPT-LOVABLE-action-guard.md`

**Interfaces:**
- Consumes: `public.action_revoked` e os triggers `wo_guard_*` da Task 1.
- Produces: nada que o código consuma — são artefactos para humanos.

- [ ] **Step 1: Escrever o script de prova**

Criar `docs/apply/VERIFY-action-guard.sql`:

```sql
-- Prova da guarda de ações em work_orders.
-- Correr no SQL editor do projeto PMSYSTEM. Tudo dentro de BEGIN/ROLLBACK:
-- não deixa rasto, nem no override nem na work order.
--
-- Antes de correr, substituir:
--   :engineer_uuid  -> auth.users.id de um utilizador com papel engineer
--   :wo_uuid        -> work_orders.id de uma ordem descartável
--
-- Para os encontrar:
--   SELECT ur.user_id, ur.role FROM user_roles ur WHERE ur.role = 'engineer' LIMIT 5;
--   SELECT id, wo_number, status FROM work_orders ORDER BY created_at DESC LIMIT 5;

-- ── BLOCO 1: com o switch desligado, tem de rebentar ─────────────────────
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.delete', false)
ON CONFLICT (role, action) DO UPDATE SET allowed = false;

SET LOCAL request.jwt.claims = '{"sub":"<engineer_uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;  -- a claim primeiro: ja com o papel trocado podes nao a poder definir

-- ESPERADO: ERROR 42501 — Permission "wo.delete" is turned off for your role.
-- Se este DELETE passar, a guarda NÃO está instalada. Parar aqui.
DELETE FROM work_orders WHERE id = '<wo_uuid>';

ROLLBACK;

-- ── BLOCO 2: com o switch ligado, tem de passar ──────────────────────────
-- Sem este bloco, uma guarda que bloqueasse toda a gente parecia sucesso.
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.delete', true)
ON CONFLICT (role, action) DO UPDATE SET allowed = true;

SET LOCAL request.jwt.claims = '{"sub":"<engineer_uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;  -- a claim primeiro: ja com o papel trocado podes nao a poder definir

-- ESPERADO: DELETE 1 (ou 0 se a RLS de work_orders já o impedia por outra razão,
-- o que também é informação: nesse caso a guarda não é o que está a bloquear).
DELETE FROM work_orders WHERE id = '<wo_uuid>';

ROLLBACK;

-- ── BLOCO 3: o trabalho automático não pode ser apanhado ─────────────────
-- Sem contexto de utilizador, action_revoked tem de devolver false mesmo com
-- o switch desligado — é o que protege o sync do iTouching e o pg_cron.
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.update', false)
ON CONFLICT (role, action) DO UPDATE SET allowed = false;

-- ESPERADO: false
SELECT public.action_revoked('wo.update') AS deve_ser_false;

ROLLBACK;
```

- [ ] **Step 2: Escrever o pedido de aplicação**

Criar `docs/apply/PROMPT-LOVABLE-action-guard.md`:

```markdown
# Aplicar: guarda de ações em work_orders

Colar no chat do Lovable do projeto PMSYSTEM.

---

Aplica a migração `supabase/migrations/20260821090000_action_guard_work_orders.sql`
que já está no repositório. Ela cria duas funções (`public.action_revoked`,
`public.enforce_action`) e cinco triggers BEFORE em `public.work_orders`.

Não alteres nenhuma política RLS existente. Não alteres nenhum ficheiro de frontend.
Não mudes o conteúdo da migração — aplica-a tal como está.

Depois de aplicar, mostra-me o resultado de:

    SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'public.work_orders'::regclass AND NOT tgisinternal;

Esperado: wo_guard_insert, wo_guard_update, wo_guard_delete, wo_guard_close, wo_guard_force.
```

- [ ] **Step 3: Confirmar que os UUIDs continuam por preencher**

Run: `grep -c "<engineer_uuid>\|<wo_uuid>" docs/apply/VERIFY-action-guard.sql`
Expected: `4` — os marcadores estão lá para serem substituídos por quem corre o script. Se este número for `0`, alguém colou UUIDs reais num ficheiro versionado; remover.

- [ ] **Step 4: Commit**

```bash
git add docs/apply/VERIFY-action-guard.sql docs/apply/PROMPT-LOVABLE-action-guard.md
git commit -m "The proof runs where the database lives, not where the code does" -- docs/apply/VERIFY-action-guard.sql docs/apply/PROMPT-LOVABLE-action-guard.md
```

---

## Fora deste plano, de propósito

- **`SELECT` não é coberto.** Esconder leitura obriga a editar políticas existentes, que foi a decisão recusada no desenho.
- **Ligar um switch acima da base não dá permissão nenhuma.** É a semântica só-negar; está na spec.
- **Os outros cinco lotes** (`downtime_events` + `downtime_corrections`, `quality_actions`, `daily_allocations`, stock, `user_roles`) só começam depois de o Bloco 1 da prova falhar como deve ser na base real.

## Alterações depois da revisão final

- `action_revoked` passou a isentar o `admin` (`current_user_role() <> 'admin'`), espelhando o invariante de `permissions.ts:307`, porque uma linha `('admin', 'wo.update', false)` já escrevível hoje na página de permissões trancaria todos os admins fora da base assim que a migração fosse aplicada.
- `docs/apply/VERIFY-action-guard.sql` deixou de testar `wo.delete`/`DELETE`: um `engineer` não tem política de DELETE em `work_orders`, e o `DELETE` seria filtrado pela RLS antes do trigger disparar, dando um falso negativo (`DELETE 0` sem erro). Os Blocos 1 e 2 passaram a testar `wo.update`/`UPDATE`.
- `docs/apply/PROMPT-LOVABLE-action-guard.md` ganhou uma consulta a correr e mostrar antes de aplicar (`SELECT role, action, allowed FROM role_permission_overrides WHERE allowed = false`), para ver com antecedência que linhas passam a ser cumpridas a sério.
- A spec corrigiu a premissa central de "Problema": não é verdade que nenhuma política consulte `role_permission_overrides` — `has_action`/`dt_insert_adjusters` em `downtime_events` já o faz; a lacuna é só fora desse ponto, incluindo `work_orders`. A spec também explica por que `action_revoked` não reaproveita `has_action` (allow-and-deny com baseline vs. só-negar) e nomeia a divergência de semântica entre as duas funções como dívida a convergir.
- `enforce_action()` trocou `RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;` pela forma `IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;`, seguindo o estilo mais claro já usado noutras funções de trigger do repositório.
- A migração ganhou `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated` depois de cada função nova, e o bloco de rollback em comentário passou a incluir os `REVOKE` correspondentes — seguindo o padrão de `has_action` e `correct_downtime_event`.
