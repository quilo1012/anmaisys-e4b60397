## Objetivo

Os KPIs (Avg Response Time, Avg Active Repair, Avg Line Downtime) atualmente mostram a média de **todas** as ordens finalizadas desde o início — por isso os valores ficam altos por causa de ordens antigas. O admin/manager quer **escolher um período** e ver os KPIs só desse período.

## Mudanças

### 1. `src/pages/dashboard/ManagerDashboard.tsx`

- Adicionar dois estados: `dateFrom` e `dateTo` (default: últimos 7 dias).
- Adicionar barra de filtros no topo do dashboard com:
  - Botões rápidos: **Hoje / 7 dias / 30 dias / Tudo**
  - Dois `DatePicker` (shadcn) para escolher intervalo customizado
- Passar `{ from: dateFrom, to: dateTo }` ao hook `useAllWoMetrics()`.
- Os 3 KPIs (`avgResponse`, `avgActiveRepair`, `avgLineDowntime`) passam a refletir só o período escolhido.
- Mostrar pequeno label sob os KPIs: "Período: 09/05 – 16/05" para deixar claro o filtro ativo.

### 2. `src/pages/dashboard/ExecutiveDashboard.tsx`

Mesmo padrão de filtro de período (mesmos botões rápidos + DatePicker), aplicado a:
- Avg Response Time
- Avg Active Repair (MTTR)
- Line Downtime Today → renomeado para "Line Downtime (período)"

O KPI "Open WOs" e "Machines at Risk" continuam tempo-real (não dependem de período).

### 3. Comportamento

- `useAllWoMetrics({ from, to })` já aceita range — não precisa alterar o hook.
- Quando o usuário troca o período, o `queryKey` muda e o React Query refaz a query automaticamente.
- Default ao abrir: **Últimos 7 dias** (mais útil que "Tudo" e evita poluição do histórico antigo).

## Detalhes técnicos

- Componente `Calendar` do shadcn com `className="p-3 pointer-events-auto"` dentro de `Popover`.
- Filtros mantêm a regra atual: só conta WOs finalizadas (`finished`, `closed`, `completed`), exclui `force_closed`.
- Pequeno componente reutilizável `DateRangeFilter` em `src/components/DateRangeFilter.tsx` para evitar duplicar UI entre os dois dashboards.

## Resultado

Ao entrar como admin/manager:
- Por default vê KPIs dos últimos 7 dias (números realistas).
- Pode clicar em "Hoje" para ver só o dia, ou escolher datas específicas (ex.: 01/05 a 10/05).
- Os históricos antigos deixam de inflar a média a menos que ele escolha "Tudo".
