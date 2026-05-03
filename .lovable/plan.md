
## Plan — 9 issues from this turn

Each item is independent and small. I'll group them into a single implementation pass.

---

### 1. Engineer NÃO recebe alerta quando operador abre Recurring Failure

**Cause**: `reopen_wo_as_recurrence` faz `UPDATE` na mesma WO (mesmo `wo_number`) voltando status para `open`. Mas `useWOAlerts.ts` só escuta `INSERT … status=eq.open`. UPDATEs open→open nunca disparam o siren.

**Fix** — `src/hooks/useWOAlerts.ts`:
- Adicionar 2º listener `UPDATE` que detecta transição para `open` (qualquer status anterior → `open`) e re-dispara `triggerAlert` com os mesmos gates (ack local, line filter, locked engineer).
- Limpar `acknowledgeWOLocal` quando virar open de novo (reset do gate por episódio — usar `current_episode` como sufixo na chave de ack: `${woId}#ep${episode}`), assim cada recorrência re-toca.

Também atualizar `src/lib/woAck.ts` para aceitar uma chave composta opcional.

---

### 2. Alerta visual + vibratório quando áudio bloqueado

**Fix** — `src/contexts/CriticalAlertContext.tsx` (e `useWOAlerts`):
- Quando `triggerAlert` dispara e `audioEnabled === false`:
  - Forçar modal full-screen vermelho piscando (já existe), mas adicionar overlay extra com `animate-pulse` borda vermelha grossa em todo viewport.
  - Disparar `navigator.vibrate([400,150,400,150,400,150,800])` em loop a cada 2s até `acknowledge`.
  - Adicionar flash do título da aba: `document.title = "🚨 NOVA WO"` alternando.
  - Ativar Wake Lock se disponível (`navigator.wakeLock`) p/ tablet não dormir.

---

### 3. Garantir layout mobile / tablet / web

**Fix** — passar revisão em larguras 360px / 768px / 1024px / 1280px nas páginas:
- `OperatorDashboard.tsx`: tabela "My Work Orders" (`overflow-x-auto`, min-widths nas colunas).
- `WorkOrderDetail.tsx`: history table já corrigido; revisar grids `md:grid-cols-2` para `lg:grid-cols-2` em telas tablet retrato.
- `EngineerDashboard.tsx`: cards stack em <768px.
- `ManagerDashboard.tsx`, `ExecutiveDashboard.tsx`, `AnalyticsPage.tsx`: KPI grid `grid-cols-2 md:grid-cols-3 xl:grid-cols-4`.
- `Login.tsx`: form com `max-w-md w-full px-4`.

---

### 4. "My Work Orders" — adicionar coluna **Created By** e filtro/gráfico por turno

**Fix** — `OperatorDashboard.tsx`:
- Coluna nova "**Created By**" entre Created e Engineer, mostrando `wo.requester_name || wo.created_by_name`.
- Adicionar tabs/filtro acima da tabela:
  - **Day Shift** (06:00–17:59)
  - **Night Shift** (18:00–05:59)
  - **All**
- Helper `getShift(date)` em `src/lib/shifts.ts`.
- Card extra "**WOs by Shift (last 7 days)**" com bar chart (recharts) mostrando Day vs Night.

---

### 5. Remover ícone PT/EN

**Fix** — `src/components/DashboardLayout.tsx` linha 314–320: remover botão de toggle de idioma. Manter `LanguageContext` (não quebra) mas sem UI de troca. App fica em English por padrão (Core memory já diz isso).

---

### 6. Engineer Alert Lines não funciona

**Investigate + Fix** — `src/hooks/useEngineerLineFilter.ts` + `EngineerAlertLineFilter.tsx`:
- Verificar se `shouldAlertForLine` está retornando `false` quando `line_id` vem `null` (de WO criada sem line). Memory diz "null line_id always alerts" mas precisa confirmar implementação.
- Garantir que filtro persiste em `localStorage` por engineer e é lido no momento do alert (não em cache de hook).
- Adicionar log + UI feedback "Filtro: 3 linhas selecionadas — 2 ignoradas" no header.

---

### 7. Finished com PIN do **operador** (dupla confirmação)

**Atual**: engineer finaliza com PIN próprio em `finish_wo_with_pin`.
**Nova regra**: ao Finish, abrir um 2º dialog "**Operator confirmation**" pedindo PIN/assinatura do operador presente. Só depois disso a WO vai para `finished`.

**Fix**:
- Nova RPC `finish_wo_with_dual_pin(_wo_id, _engineer_pin, _operator_user_id, _operator_signature)`:
  - Valida engineer pin (existing `verify_engineer_pin`)
  - Valida que `_operator_user_id` tem role `operator` E que pertence à `operator_line_accounts` da `wo.line_id`
  - Stamp `signed_by_name = operator name`, `operator_confirmed_at = now()`.
- UI: `WorkOrderDetail.tsx` — após engineer entrar PIN, abre 2º step "Pass tablet to operator — they confirm" com Select de operador online + assinatura desenhada.
- Novo campo `operator_confirmed_at` em `work_orders` (migration).

---

### 8. Impressão da WO sem dados da máquina

**Cause**: PDF/print template está lendo só `wo.machine` (string). Se vazio, sai blank. Não busca `machines` table.

**Fix** — `src/lib/generatePdfReport.ts` (e print view em `WorkOrderDetail.tsx`):
- JOIN: ao gerar print, buscar `machines` por `wo.machine` (name) OU `wo.line_id` e popular: `code`, `sector`, `line`, `machine_type`, `current_location`, `health_score`.
- Layout do header de impressão: bloco "Machine" com Code, Type, Line, Sector, Location.

---

### 9. Numeração profissional WO (sugestões)

Sugestão: **`WO-YYYYMM-NNNN`** (e.g. `WO-202605-0042`) — reseta sequência por mês, mostra ano+mês visíveis, ainda curto.
Alternativas:
- `WO-YYYY-NNNNNN` (atual)
- `WO-YYMMDD-NNN` (diário, fica longo no ano)
- `WO-2026-Q2-0042` (trimestral)

**Recomendação**: manter `wo_number` global no DB (não muda nada) mas mudar **display format** para `WO-YYYYMM-####` calculado client-side a partir de `created_at` + uma sequência mensal derivada (count WOs no mesmo mês).

Vou implementar `WO-YYYYMM-NNNN` em `src/lib/woFormat.ts` e propagar.

---

### 10. Engineer Accept / Decline com timeline

**Fix**:
- No modal crítico (`CriticalAlertContext`): adicionar 2 botões — **ACCEPT** (atual) e **DECLINE** (novo).
- DECLINE:
  - Abre prompt para motivo (obrigatório, dropdown: "Em outra WO", "Fora de turno", "Não é minha linha", "Outro").
  - Insere `work_order_logs` com action `declined: <reason>`.
  - Ack local para parar siren neste engineer, mas WO continua `open` para outros engineers.
  - Engineer pode reabrir depois via "My Open Alerts" (lista nova no EngineerDashboard) e Accept.
- `WoTimeline.tsx`: render de eventos `declined: …` com ícone vermelho e nome do engineer + motivo.

---

## Database changes (1 migration)

```sql
-- 1. Operator dual confirmation
ALTER TABLE public.work_orders
  ADD COLUMN operator_confirmed_at timestamptz,
  ADD COLUMN operator_confirmed_by uuid;

-- 2. New RPC: finish_wo_with_dual_pin (engineer PIN + operator validation)
CREATE OR REPLACE FUNCTION public.finish_wo_with_dual_pin(
  _wo_id uuid, _engineer_pin text,
  _operator_id uuid, _operator_signature text
) RETURNS jsonb ...

-- 3. Decline log helper (uses existing work_order_logs)
-- no schema change needed
```

## Files to edit

- `src/hooks/useWOAlerts.ts` (UPDATE listener for recurrence)
- `src/lib/woAck.ts` (composite key)
- `src/contexts/CriticalAlertContext.tsx` (visual+vibration fallback, decline button)
- `src/components/DashboardLayout.tsx` (remove PT/EN)
- `src/pages/dashboard/OperatorDashboard.tsx` (Created By column, shift filter+chart, layout)
- `src/pages/dashboard/WorkOrderDetail.tsx` (dual-PIN finish dialog, machine data in print)
- `src/lib/generatePdfReport.ts` (machine join)
- `src/lib/woFormat.ts` (new YYYYMM format)
- `src/lib/shifts.ts` (getShift helper)
- `src/hooks/useEngineerLineFilter.ts` (debug + fix null handling)
- `src/components/WoTimeline.tsx` (decline events)
- `src/components/EngineerAlertLineFilter.tsx` (UI feedback)
- New migration file
- Memory updates: `mem://funcionalidades/numeracao-ordens`, new `mem://funcionalidades/dual-pin-finish`, `mem://funcionalidades/decline-wo`

Ready to implement on approval.
