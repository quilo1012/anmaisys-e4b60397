# Plano — Corrigir responsividade (mobile + tablet estreito)

Alvo: funcionar bem em **≤640px (mobile)** e **~500–800px (tablet retrato / janela dividida)**, como no print (Shift History a 506px).

## Escopo — telas de maior impacto

1. **ShiftHistoryPage** (tela atual do print)
2. **ProductionPerformancePage** (filtros de data duplos + tabela larga)
3. **DowntimePage** (filtros + tabela + botões Print/PDF/XLSX)
4. **WorkOrdersPage** (lista + filtros + bulk actions)
5. **AnalyticsPage / ExecutiveDashboard** (grids de KPI e cards)
6. **ManagerDashboard / EngineerDashboard** (cards de resumo)
7. **RAGWeeklyPage** e **ProductionPlannerPage** (grids semanais)

Fora do escopo desta rodada: telas do Operador (já otimizadas para tablet), Login, Control Center (TV mode).

## Correções padrão aplicadas em cada tela

**Headers de página**
- `flex-wrap` + `gap-2` no header; título quebra antes dos botões
- Botões de ação: `w-full sm:w-auto` em mobile; ícones sem texto abaixo de 400px (`hidden xs:inline`)

**Barras de filtro**
- Trocar `flex` linear por `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`
- Inputs de data lado-a-lado: `grid-cols-2` já em mobile (From/To sempre juntos)
- Selects: `w-full` em mobile, largura fixa apenas em `md+`
- Botões Today/Reset em linha própria full-width no mobile

**Tabelas largas**
- Wrapper `overflow-x-auto -mx-4 sm:mx-0` para permitir scroll sem cortar padding
- Manter colunas essenciais visíveis; colunas secundárias `hidden md:table-cell`
- Em mobile, converter linhas críticas (ex: WorkOrders, ShiftHistory) para **card list** abaixo de `sm` usando `hidden sm:block` na tabela + `sm:hidden` no card stack

**Grids de KPI / cards**
- Padronizar: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`
- Números grandes: `text-2xl md:text-3xl` (não vazar container)
- Paddings responsivos: `p-3 md:p-6`

**Dialogs / Popovers**
- `max-w-[95vw]` em `DialogContent` para não cortar
- Popovers com `w-[--radix-popover-trigger-width]` já usados; auditar os que têm largura fixa

**Sidebar / Layout**
- Confirmar que `DashboardLayout` esconde sidebar em `<md` e mostra hamburguer (já feito recentemente, apenas validar nas telas listadas)

## Detalhes técnicos

- Adicionar breakpoint `xs: 480px` no `tailwind.config.ts` para o tier extra apertado (500px como no print).
- Nenhuma mudança de lógica de negócio, dados, RLS ou queries. Só classes Tailwind + reordenação JSX.
- Sem novos componentes; reutilizar `Card`, `Button`, `Select` existentes.
- Validação: rodar Playwright em 375px, 506px e 768px em cada uma das 7 telas listadas, capturar screenshot e conferir que nada estoura horizontalmente e todos os controles são clicáveis.

## Entrega em 2 passos

1. **Passo 1** — ShiftHistory, ProductionPerformance, Downtime, WorkOrders (as 4 mais usadas / mais quebradas).
2. **Passo 2** — Analytics, Executive, Manager, Engineer, RAG Weekly, Planner.

Posso emendar os dois passos numa entrega só se preferir. Confirma que sigo?
