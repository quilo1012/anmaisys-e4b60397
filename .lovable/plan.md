

# Redesign e Funcionalidades CMMS -- Gap Analysis e Implementacao

## Funcionalidades JA Implementadas (nenhuma alteracao necessaria)

| Feature | Status |
|---------|--------|
| Logo login (120px) + sidebar (32px) | Implementado |
| Titulo do navegador "AN Maintenance" | Implementado |
| Login com gradiente escuro, glassmorphism, icones | Implementado |
| Sidebar com navegacao por role | Implementado |
| Machine dropdown padronizado | Implementado |
| Problem Description dropdown padronizado | Implementado |
| WO criacao por Operador e Manager | Implementado |
| Manager CRUD completo em WOs (editar, deletar, force close) | Implementado |
| Alertas engenheiro (som loop 60s + web notification + toast) | Implementado |
| Engineer Start/Complete com assinatura digital | Implementado |
| Registro de pecas usadas pelo engenheiro | Implementado |
| Estoque com categorias, alertas low stock, CRUD completo | Implementado |
| KPIs (Avg Response, Avg MTTR, Parts Today, Low Stock) | Implementado |
| Graficos (WOs/Day, Top 5 Machines, Top 5 Problems) | Implementado |
| Filtros (data, status, problem description) | Implementado |
| Print layout profissional com timeline e logo | Implementado |
| Gestao de usuarios (criar, editar email/senha, deletar) | Implementado |
| Exportacao CSV | Implementado |
| Relogio em tempo real no header | Implementado |
| RLS + Edge Functions para seguranca | Implementado |

---

## Funcionalidades NOVAS a Implementar

### 1. Campo de Observacao Livre (Opcional) na Criacao de WO

Adicionar campo `notes` (textarea, opcional) nos formularios de criacao de WO do Operador e Manager, para que o operador possa adicionar contexto adicional alem da descricao padronizada.

**Database:** Adicionar coluna `notes text DEFAULT ''` na tabela `work_orders`

**Arquivos:**
- Migration SQL (nova coluna `notes`)
- `src/hooks/useWorkOrders.ts` -- adicionar `notes` ao insert/update
- `src/pages/dashboard/OperatorDashboard.tsx` -- adicionar Textarea para notes
- `src/pages/dashboard/ManagerDashboard.tsx` -- adicionar Textarea para notes nos dialogs criar/editar
- `src/pages/dashboard/WorkOrderDetail.tsx` -- exibir notes se preenchido

### 2. Filtros Adicionais na Tabela de WOs do Manager

Adicionar filtros por **Machine** e por **Operador/Engenheiro** na tabela do Manager Dashboard.

**Arquivo:** `src/pages/dashboard/ManagerDashboard.tsx`
- Novo state `machineFilter`
- Novo `Select` dropdown com lista de machines
- Atualizar `filteredWOs` useMemo para incluir filtro por machine

### 3. Busca (Search) na Tabela de WOs

Adicionar campo de busca textual que filtra por WO number, requester name, machine ou description.

**Arquivo:** `src/pages/dashboard/ManagerDashboard.tsx`
- Novo state `searchTerm`
- Input de busca ao lado dos filtros
- Filtro no `filteredWOs` useMemo

### 4. Grafico de Uso de Pecas por Categoria

Adicionar um quarto grafico no Manager Dashboard mostrando consumo de pecas agrupado por categoria.

**Arquivo:** `src/pages/dashboard/ManagerDashboard.tsx`
- Novo hook query para buscar `parts_used` com join em `products`
- useMemo para agregar por categoria
- Novo card com BarChart

### 5. Kanban Board View (Open / In Progress / Completed)

Adicionar uma visao Kanban com colunas color-coded no Manager Dashboard, alternavel com a visao de tabela.

**Arquivo:** `src/pages/dashboard/ManagerDashboard.tsx`
- Toggle entre "Table" e "Board" view
- Componente Kanban com 3 colunas (Open = azul, In Progress = amber, Completed = verde)
- Cards mostrando Machine, Problem, Operador, Engenheiro
- Click no card navega para WO detail

### 6. Paginacao na Tabela de WOs

Adicionar paginacao simples (prev/next, 20 items por pagina) na tabela do Manager.

**Arquivo:** `src/pages/dashboard/ManagerDashboard.tsx`
- State `currentPage`
- Slice dos `filteredWOs` por pagina
- Botoes prev/next com contagem

---

## Sequencia de Implementacao

1. **Migration SQL** -- adicionar coluna `notes` na `work_orders`
2. **useWorkOrders.ts** -- suporte a `notes`
3. **OperatorDashboard.tsx** -- campo notes
4. **ManagerDashboard.tsx** -- campo notes + filtros (machine, search) + kanban + paginacao + grafico pecas
5. **WorkOrderDetail.tsx** -- exibir notes

## Arquivos Modificados

| Arquivo | Alteracao |
|---------|-----------|
| Migration SQL | Coluna `notes` em `work_orders` |
| `src/hooks/useWorkOrders.ts` | Campo `notes` no insert/update/type |
| `src/pages/dashboard/OperatorDashboard.tsx` | Textarea notes opcional |
| `src/pages/dashboard/ManagerDashboard.tsx` | Notes nos dialogs + filtro machine + search + kanban view + paginacao + grafico pecas por categoria |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Exibir notes |

