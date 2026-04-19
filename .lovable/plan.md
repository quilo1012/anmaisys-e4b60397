# Plano: RBAC + Sidebar Colapsável + Polish

Execução **uma fase por vez**. Cada fase só inicia após aprovação explícita do usuário.

---

## Fase 1 — Sidebar colapsável (Parte B)
**Objetivo:** rail de ícones com tooltips, persistência, atalho Ctrl+B, drawer mobile.

- Refatorar `DashboardLayout.tsx` para usar `Sidebar collapsible="icon"` (shadcn).
- `SidebarTrigger` no header (sempre visível).
- Prop `tooltip` em cada `SidebarMenuButton` (label aparece quando colapsada).
- Persistência via cookie nativa do `SidebarProvider`.
- Mobile <768px: drawer offcanvas automático.
- Atalho Ctrl/Cmd+B nativo.

**Arquivos:** `src/components/DashboardLayout.tsx` + extrair `AppSidebar.tsx`.
**Risco:** baixo (UI only).

---

## Fase 2 — Roles + helper `useRole` + matriz de permissões
- Migration: criar `current_user_role()`. `has_role` já existe.
- `src/lib/permissions.ts` com tipo `Role` e `can(role, action)`.
- Hook `useRole()` reusa `useAuth().role`.

**Risco:** baixíssimo (código novo).

---

## Fase 3 — UI Gates (esconder botões por role)
- `can()` em: New WO, Delete, Close, Print/PDF, links Users/Audit Logs.
- Sidebar filtra por `can()` em vez de `roles.includes()`.

**Risco:** baixo (RLS inalterada).

---

## Fase 4 — RLS em tabelas não-críticas
**Tabelas:** `machines`, `problem_descriptions`, `audit_logs`, `product_categories`.

- Garantir viewer com SELECT onde matriz pede.
- Operator sem acesso a `audit_logs`.
- Adicionar policies faltantes.

**Risco:** médio.

---

## Fase 5 — RLS em `work_orders` (turno isolado)
- SELECT: admin/manager/engineer/viewer = todos; operator = `operator_id = auth.uid()`.
- INSERT: admin/manager/operator.
- UPDATE: admin/manager; engineer só se `locked_engineer_id = auth.uid() OR NULL`.
- DELETE: **só admin** (remove permissão do manager).
- Rollback SQL documentado.

**Risco:** alto (coração do sistema).

---

## Fase 6 — Página `/dashboard/users` (admin only)
- Gate admin no `ProtectedRoute` + toast "Access denied".
- Coluna "Last Login".
- Audit log em mudanças de role.
- Reset PIN só admin.

**Risco:** baixo.

---

## Fase 7 — Polish (Parte C)
1. Empty states em todas tabelas.
2. Skeletons substituindo spinners full-page.
3. ErrorBoundary por rota.
4. Breadcrumbs no header.
5. Toasts sonner padronizados.
6. Tokens semânticos (sem hex hardcoded).
7. Dark mode parity.
8. A11y (aria-labels, focus rings, AA).
9. Limpar console.logs.

Possível dividir em 7a/7b.
**Risco:** baixo.

---

## Conflitos confirmados
- Operator **sem** lista de WOs (mantém fluxo atual).
- Manager **perde DELETE** de WO (só admin).
- Engineer mantém visão restrita (atribuídas + abertas).

Se quiser mudar algum, avise antes da Fase 5.

---

## Próximo passo
Aguardando **"aprovado, Fase 1"** para começar pela sidebar.
