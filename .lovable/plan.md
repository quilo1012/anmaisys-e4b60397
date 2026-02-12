

# Melhorias Pendentes - AN Maintenance

## Status Atual

A grande maioria dos itens solicitados ja esta implementada:
- Logo e branding (login 120px, sidebar 32px, titulo "AN Maintenance")
- Login com gradiente escuro, blur, icones, sem sign-up
- Icones Lucide consistentes (ClipboardList, Play, PenTool, Package, etc.)
- Alertas sonoros HTML5 Audio WAV em loop (1s/60s) + Web Notifications
- Campo "Requested By" (substituiu "Production Line")
- Assinatura digital por nome ao completar WO
- Categorias dinamicas de estoque gerenciadas pelo admin
- Registro de pecas por engenheiro com atualizacao de estoque
- CRUD de usuarios pelo manager
- CRUD de WOs pelo manager (criar/editar/deletar/force close)
- Exportacao CSV
- KPIs (response time, MTTR, parts used)
- Graficos (WOs por dia, top maquinas)
- Timeline completa no WO detail
- Realtime updates via channels
- Coluna "Parts" no Operator e Engineer Dashboard
- Impressao basica com botao Print

## Funcionalidades Novas a Implementar

### 1. Relogio Digital no Header

Adicionar componente `LiveClock` no header do `DashboardLayout.tsx` exibindo hora (HH:MM:SS) e data (DD/MM/YYYY), atualizado a cada segundo, estilo industrial/clean.

**Arquivo:** `src/components/DashboardLayout.tsx`

### 2. Tabela de Maquinas + Dropdown

Substituir o campo livre "Machine" por um dropdown com maquinas predefinidas da fabrica.

**Database:**
```text
CREATE TABLE public.machines (id, name, created_at)
RLS: admins CRUD, todos authenticated SELECT
```

**Novos arquivos:**
- `src/hooks/useMachines.ts` -- hook para listar/criar/deletar maquinas

**Arquivos modificados:**
- `src/pages/dashboard/OperatorDashboard.tsx` -- Input vira Select para Machine
- `src/pages/dashboard/ManagerDashboard.tsx` -- Input vira Select para Machine (criar/editar WO)
- Manager Dashboard tera uma secao para gerenciar maquinas (adicionar/remover) inline ou via dialog

### 3. Filtros Rapidos de Data no Manager Dashboard

Adicionar botoes de filtro rapido acima da tabela de WOs:
- Hoje (default quando nenhuma data selecionada)
- Ontem
- Ultimos 7 Dias
- Este Mes

Filtrar tanto a tabela quanto os KPIs e graficos.

**Arquivo:** `src/pages/dashboard/ManagerDashboard.tsx`

### 4. Layout de Impressao Profissional

Melhorar o CSS de impressao no `WorkOrderDetail.tsx`:
- Cabecalho com logo da empresa + "AN Maintenance" (visivel apenas no print)
- Todos os timestamps formatados
- Assinatura do engenheiro
- Pecas usadas
- Numero da WO em destaque
- Area reservada para stamp (sera adicionado quando a imagem for enviada)

**Arquivo:** `src/pages/dashboard/WorkOrderDetail.tsx` + `src/index.css`

## Detalhes Tecnicos

### Migration SQL

```text
CREATE TABLE public.machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage machines" ON public.machines
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view machines" ON public.machines
  FOR SELECT USING (
    has_role(auth.uid(), 'operator'::app_role) OR
    has_role(auth.uid(), 'engineer'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  );
```

### Resumo de Arquivos

| Arquivo | Alteracao |
|---------|-----------|
| **Migration SQL** | Tabela `machines` com RLS |
| `src/hooks/useMachines.ts` | Novo hook CRUD maquinas |
| `src/components/DashboardLayout.tsx` | LiveClock no header |
| `src/pages/dashboard/ManagerDashboard.tsx` | Filtros rapidos de data + dropdown maquinas + gestao de maquinas |
| `src/pages/dashboard/OperatorDashboard.tsx` | Dropdown maquinas |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Layout de impressao profissional com cabecalho |
| `src/index.css` | Melhorias no `@media print` |

### Itens Diferidos
- **Stamp/Carimbo**: layout preparado, imagem sera adicionada quando enviada
- **QR Code**: proxima etapa conforme combinado
- **Auditor role**: pode ser adicionado futuramente como nova enum

