
# Plano: Banner de Permissão + Histórico Avançado de Downtime

## 🎯 Objetivos
1. Mostrar **banner explicativo** quando o usuário não tem permissão para parar/retomar a linha, indicando **qual linha** ele precisa ter acesso.
2. Adicionar uma **seção rica de histórico de downtime** na página de detalhes da WO, com filtros por **data** e por **operador/usuário**.

---

## 1️⃣ Banner de Bloqueio em `LineDowntimeControl.tsx`

### Comportamento atual
Hoje, quando `canControl` é `false`, o componente simplesmente **omite** os botões de "Stop Line" / "Machine Back to Work" — o operador fica sem entender por que não consegue agir.

### Mudança proposta
Quando `canControl === false` E o usuário tem role `operator`, renderizar um banner âmbar (warning) logo abaixo do status da linha, contendo:

- **Ícone**: `<Lock />` ou `<ShieldAlert />` (lucide-react)
- **Título**: `"Downtime control blocked"`
- **Mensagem dinâmica**:
  - Se `lineId` existe → buscar nome da linha via `useLines()` e exibir:  
    `"You need access to line "<LineName>" to stop or resume this work order. Ask an admin to add this line to your tablet account."`
  - Se `lineId` é `null` → `"This work order is not bound to a line. Ask an admin to assign one."`
- Para outras roles (`viewer`, etc.) → mensagem genérica `"Your role does not allow controlling line downtime."`

### Implementação
- Importar `useLines` de `@/hooks/useMachines` e `Lock` de `lucide-react`.
- Resolver `lineName` com `useMemo`: `lines?.find(l => l.id === lineId)?.name`.
- Renderizar o banner em **CASE A**, **CASE B** e **CASE C** quando `!canControl`, no lugar onde hoje os botões aparecem.
- Estilo: `rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700` com `flex items-start gap-2`.

---

## 2️⃣ Histórico Completo de Downtime em `WorkOrderDetail.tsx`

### Situação atual
Hoje há apenas o `DowntimeTimelineCard` (linha 538) que lista todos os eventos sem nenhum filtro.

### Mudança proposta
Criar um **novo componente** `src/components/DowntimeHistorySection.tsx` que substitui (ou complementa abaixo de) o `DowntimeTimelineCard` na WO Detail, contendo:

#### Filtros (toolbar no topo)
- **Date range**: dois `<Input type="date">` (from / to) — filtra por `stopped_at`.
- **Operator/User**: `<Select>` populado dinamicamente com todos os `stopped_by_name` e `resumed_by_name` distintos dos eventos da WO + opção "All".
- Botão `"Clear filters"` para resetar.

#### Tabela de eventos (usando `<Table>` do shadcn)
Colunas:
| # | Stopped at | Stopped by | Reason | Resumed at | Resumed by | Resume note | Duration | Type |
|---|---|---|---|---|---|---|---|---|
| ep# | dd/MM HH:mm | name | text | dd/MM HH:mm or "— ongoing" | name | text | `Xh Ym` (via `formatMinutes`) | Badge "Recurrence" se `is_recurrence` |

- Linhas com `resumed_at = null` → destaque vermelho com timer ao vivo (já temos pattern em `DowntimeTimelineCard`).
- Ordenação: mais recente primeiro.

#### Resumo abaixo da tabela
- Total de stops filtrados
- Soma de minutos (formatada via `formatMinutes` de `@/lib/formatDuration`)
- Quantidade de recorrências

### Reuso de hooks
- `useDowntimeEvents(workOrderId)` já retorna todos os eventos com nomes e timestamps.
- Filtragem feita inteiramente no client com `useMemo`.

### Integração na página
- Em `WorkOrderDetail.tsx`, **substituir** a linha 538 `<DowntimeTimelineCard workOrderId={wo.id} />` por `<DowntimeHistorySection workOrderId={wo.id} />`.
- Manter o `DowntimeTimelineCard` apenas para o layout de **impressão** (já tem `print:` styles), ou mover a versão print para o novo componente. **Decisão: mover** — o novo componente terá tanto a UI rica quanto a tabela de print, eliminando duplicação. Removeremos a linha 538 do `DowntimeTimelineCard` e adicionaremos o novo componente.

---

## 📁 Arquivos afetados
| Arquivo | Ação |
|---|---|
| `src/components/LineDowntimeControl.tsx` | Editar — adicionar banner de bloqueio quando `!canControl` |
| `src/components/DowntimeHistorySection.tsx` | **Criar** — nova seção com filtros |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Editar — trocar `DowntimeTimelineCard` por `DowntimeHistorySection` |

## ⚠️ Sem mudanças de DB ou RLS
Toda a lógica é client-side — nenhuma migração necessária. As políticas RLS já garantem que os dados visíveis são apenas os autorizados.

## ✅ Critérios de aceitação
- Operador da Line 1 abrindo WO da Line 2 vê banner âmbar: *"You need access to line 'Line 2'..."*.
- Admin na WO Detail vê tabela completa, pode filtrar por data (ex: últimas 24h) e por nome do operador, com totais atualizados.
- Versão impressa (print) continua funcionando.
