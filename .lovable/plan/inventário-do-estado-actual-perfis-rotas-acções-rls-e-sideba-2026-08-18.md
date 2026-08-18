# Inventário do estado actual — perfis, rotas, acções, RLS e sidebar

Relatório apenas. Nada foi alterado.

## 1) Roles

Enum `public.app_role` (12 valores): `admin, engineer, operator, manager, viewer, maintenance_manager, co_engineer, supervisor, planner, warehouse, quality_supervisor, production_office_admin`.

Armazenamento: tabela `public.user_roles (id, user_id, role)`. `public.profiles` NÃO tem coluna de role (colunas: id, name, email, active, shift, created_at, updated_at, last_seen_at, labor_rate, ui_preferences, production_line).

Distribuição real hoje: admin=10, operator=12, engineer=2, quality_supervisor=2, maintenance_manager=1, warehouse=1. Os restantes 6 perfis existem no enum e na matriz mas não têm nenhum utilizador atribuído.

Leitura no servidor: RPC `public.get_user_role(_user_id)`, mais `has_role`, `has_any_role`, `has_action` (esta resolve a matriz + overrides dentro da base de dados).

## 2) Frontend — onde o role é lido e verificado

- `src/contexts/AuthContext.tsx` — única fonte: chama `supabase.rpc("get_user_role")` (linha ~215), guarda `role` no estado; se não houver role lança "No access role is assigned to this account.".
- `src/lib/permissions.ts` (497 linhas) — matriz `MATRIX: Record<Action, Role[]>` com ~80 acções, `can()`, `canAny/canAll`, `canForDevice`, `roleDashMap`, `dashboardPathFor`, `ALL_ACTIONS`, `ALL_ROLES`, `ACTION_GROUPS`. Nota: `can()` faz `if (role === "admin") return true` — o admin passa sempre, ignorando overrides.
- Overrides em runtime: `setPermissionOverrides` (tabela `role_permission_overrides`) e `setDeviceHidden` (`role_mobile_hidden`), sincronizados por `PermissionOverridesSync` em `src/App.tsx`.
- `src/hooks/useRole.ts` — ponte `useAuth().role` → `can()`.
- `src/components/ProtectedRoute.tsx` — guarda de rota: admin passa sempre; `co_engineer` herda `engineer`; se existir `requiredAction`, decide SÓ por `can()` e ignora `allowedRoles`; senão usa `allowedRoles`; depois aplica `isDeviceHidden`.
- `src/components/DashboardLayout.tsx` — filtra `navItems` por role + acção + dispositivo.
- `src/components/RoleShortcutGrid.tsx` — deriva os atalhos dos mesmos `navItems`.
- `src/pages/dashboard/PermissionsMatrixPage.tsx` — edição dos overrides (admin).
- ~74 ficheiros em `src/` chamam `useAuth()`/`useRole()` para esconder botões.

## 3) Rotas (todas, `src/App.tsx`)

Públicas (sem guarda): `/login` (Login.tsx), `/signup` (SignUp.tsx), `/reset-password` (ResetPassword.tsx), `/.lovable/oauth/consent` (OAuthConsent.tsx).

Redirects sem guarda própria: `/`, `/*`, `/dashboard/home` → `SessionRedirect`; `/dashboard/work-orders/:id` → `LegacyWoLinkRedirect`; `/dashboard/workforce` → `/dashboard/people`; `/dashboard/line-hub` → `/dashboard/operator`; `/dashboard/downtime-map` → `/dashboard/downtime`.

Autenticada mas SEM role nem acção: `/dashboard/leader/scorecard` (LeaderMyScorecardPage.tsx) — gate é o PIN na base de dados.

Protegidas só por `allowedRoles` (sem acção, logo sem override possível): `/dashboard/warehouse` (WarehouseDashboard), `/dashboard/system` (SystemHubPage — admin+manager), `/dashboard/operator-chat-settings` (admin+manager), `/dashboard/shift-password-settings` (admin), `/dashboard/root-diagnostics` (admin).

Protegidas por acção (`requiredAction` manda):

| Rota | Ficheiro | Acção |
|---|---|---|
| /dashboard/operator | OperatorDashboard.tsx | dashboard.operator |
| /dashboard/operator/my-production | MyProductionPage | production.target.view |
| /dashboard/operator/performance | OperatorPerformancePage.tsx | production.performance.view |
| /dashboard/engineer | EngineerDashboard.tsx | dashboard.engineer |
| /dashboard/manager | ManagerDashboard.tsx | dashboard.manager |
| /dashboard/analytics | AnalyticsPage | reports.analytics |
| /dashboard/reports | ReportsPage.tsx | reports.analytics |
| /dashboard/work-orders | WorkOrdersPage | wo.view |
| /dashboard/wo/:id | WorkOrderDetail.tsx | wo.view |
| /dashboard/machines, /machines/:name/history | MachinesPage, MachineHistoryPage | machines.view |
| /dashboard/problems | ProblemsPage.tsx | problems.view |
| /dashboard/control-center | ControlCenterPage.tsx | controlcenter.view |
| /dashboard/people, /leave, /finance-close, /attendance | PeoplePage, LeavePage, FinanceClosePage, AttendancePage | workforce.view (admin only) |
| /dashboard/headcount | ProductionHeadcountPage | headcount.view (admin only) |
| /dashboard/audit-logs | AuditLogsPage.tsx | audit.view |
| /dashboard/downtime | DowntimePage | downtime.view |
| /dashboard/preventive | PreventiveMaintenancePage.tsx | pm.view |
| /dashboard/pm-intelligence | PMIntelligencePage.tsx | pm.view |
| /dashboard/reliability | ReliabilityDashboard.tsx | reliability.view |
| /dashboard/stock | StockPage.tsx | stock.view |
| /users/manage, /dashboard/users | ManageUsers.tsx | users.manage |
| /dashboard/permissions | PermissionsMatrixPage.tsx | permissions.manage |
| /dashboard/settings | SettingsPage.tsx | system.settings |
| /dashboard/suppliers | SuppliersPage.tsx | suppliers.view |
| /dashboard/sku-products | SKUProductsPage.tsx | sku.manage |
| /dashboard/production-performance | ProductionPerformancePage | production.performance.view |
| /dashboard/quality, /quality-report | QualityPage.tsx | quality.view |
| /dashboard/shift-history | (Production Control) | production.manage |
| /dashboard/rag-weekly | RAG Weekly | rag.view |
| /dashboard/leader-scorecard | LeaderScorecardWeekPage.tsx | scorecard.fill |
| /dashboard/leader-scorecard/:leader | LeaderScorecardDetailPage.tsx | production.performance.view |
| /dashboard/line-production | LineProductionScreen.tsx | production.manage |
| /dashboard/line-display | LineDisplayScreen.tsx | production.view |
| /dashboard/intouch-settings, -machines, -stop-codes | Intouch*Page.tsx | intouch.manage |
| /dashboard/messages | DirectMessagesPage.tsx | chat.dm |

## 4) Acções sensíveis por área e se verificam role

Verificadas pela matriz (existe acção dedicada): apagar/forçar OM (`wo.delete`, `wo.force` — admin), fechar OM (`wo.close`), corrigir downtime (`downtime.correct` — admin + maintenance_manager, validado também no RPC `correct_downtime_event` via `has_action`), ajustar downtime (`downtime.adjust`), preços de stock (`stock.pricing` — admin), gerir utilizadores (`users.manage`), limpar sistema (`system.clear`), definições (`system.settings`), matriz de permissões (`permissions.manage`), exportar relatórios (`reports.export` via `canPrintReport`), validar/fechar qualidade (`quality.validate` / `quality.close`, espelhado no trigger `enforce_quality_validation`), aprovar scorecard (`scorecard.approve`), gerir SKU (`sku.manage`), gerir RAG (`rag.manage`), gerir PM (`pm.manage`), gerir iTouching (`intouch.manage`), gerir headcount/attendance (`headcount.manage`, `attendance.manage`, `workforce.manage`).

Sem acção dedicada (só role na rota, ou nada): SystemHubPage, OperatorChatSettingsPage, ShiftPasswordSettingsPage, RootDiagnosticsPage, WarehouseDashboard. Importações (RAG template import, `import_sku_products`, `import_production_rows`) e exportações CSV/Excel/PDF não têm todas uma acção própria — parte é coberta por `rag.manage`/`sku.manage`, parte não é verificada no cliente. Thresholds e parâmetros (`leader_scorecard_threshold`, `leader_score_weights`, `quality_severity_points`) são lidos por todos os autenticados; a escrita é a que está restringida.

## 5) RLS

132 tabelas em `public`. RLS activo em 132 — nenhuma tabela com RLS desligado. Nenhuma policy concede acesso ao papel `anon`, e o `anon` não tem qualquer GRANT em `public` (0 grants). A única policy que menciona `anon` é `system_settings` → "Deny anon access", com `using=false`.

Destaques:
- **`shift_passwords` — RLS activo e ZERO policies.** Fica inacessível pela API (fail-closed), mas é uma tabela órfã: ou tem policies explícitas ou deve deixar de existir.
- **Policies com `USING (true)` (leitura aberta a qualquer autenticado)**: `headcount_areas`, `intouch_stop_code_catalog`, `leader_line_assignment`, `leader_score_weights`, `leader_scorecard_threshold`, `leader_weekly_scorecard`, `login_branding`, `quality_severity_points`, `rag_weekly_comments`, `site_banner`. Em catálogos e branding é intencional; em `leader_weekly_scorecard` e `rag_weekly_comments` significa que qualquer conta autenticada — incluindo os 12 tablets de operador — lê o scorecard de todos os líderes e os comentários semanais.
- **~20 tabelas `*_bak_*` / `*_backup*` / `*_dedupe*`** (wo802/803/804, `wo_dedupe_backup_20260804`, `employees_backup_*`, `daily_allocations_backup_0308`, `attendance_days_bak_20260804`, `overtime_entries_backup_20260802`, `sku_products_backup`, etc.) têm 1 policy cada, geralmente restrita a admin, mas contêm cópias integrais de dados de pessoas e ordens.
- Apenas leitura, sem escrita pela API: `downtime_corrections`, `intouch_*_log/runs/quota`, `pin_attempts`, `teams_webhook_logs` (escrita só por RPC/service_role) — está correcto.
- `user_roles` tem 9 policies — vale a pena consolidar antes de mexer nos perfis.

## 6) Sidebar

- Layout e sidebar: `src/components/DashboardLayout.tsx` (727 linhas), sobre os componentes shadcn `@/components/ui/sidebar`.
- Lista de itens: `export const navItems: NavItem[]` (linha ~71) — cada item tem `title`, `shortTitle?`, `url`, `icon`, `roles[]`, `group`, `action?`. Grupos usados: Overview, Maintenance, Production, Planning, Reports, Communication, Administration, System. Filtragem em `filteredItems` (~linha 518) por role + `canForDevice(action)`.
- Colapso e persistência: **já existem**. `type SidebarUiState = "expanded" | "rail" | "hidden"` (~linha 212), ciclo por botão do cabeçalho / rail / `Ctrl+B`, gravado em `localStorage` sob `SIDEBAR_STATE_KEY` e `SIDEBAR_STORAGE_KEY`; por omissão expandido em ≥1024px, rail em tablet/telemóvel. Grupos abrem em acordeão (`openGroup`).
- Testes que fixam a forma da sidebar: `src/__tests__/navigation.test.ts` (nada de infraestrutura fora do hub System, sem grupos de um item, ordem do grupo Production, ícones não repetidos lado a lado, `shortTitle` ≤ 11 caracteres na barra inferior).
- Os mesmos `navItems` alimentam `RoleShortcutGrid.tsx` — mudar a sidebar muda o ecrã de atalhos.

## 7) Cinco sítios onde hoje se chega a mais do que se devia

1. **`can()` devolve `true` para admin antes de consultar overrides** (`src/lib/permissions.ts`). Não há maneira de retirar uma capacidade a um admin, e há 10 contas admin — mais de metade dos utilizadores com role atribuído. Qualquer desenho de perfis começa por reduzir esse número.
2. **Rotas com `allowedRoles` e sem `requiredAction`**: `/dashboard/system` (admin+manager), `/dashboard/operator-chat-settings` (admin+manager), `/dashboard/shift-password-settings`, `/dashboard/root-diagnostics`, `/dashboard/warehouse`. Escapam à matriz e aos overrides — a página de permissões não as consegue governar, e um manager entra no hub System por URL directo.
3. **`leader_weekly_scorecard` e `rag_weekly_comments` com `USING (true)`**: qualquer sessão autenticada, incluindo os tablets de linha partilhados, lê o desempenho semanal de todos os líderes e os comentários de gestão. É avaliação de pessoas visível para o chão de fábrica.
4. **Tabelas de backup (~20)** com cópias completas de `employees`, `attendance_days`, `overtime_entries` e ordens de trabalho. Mesmo restritas a admin, mantêm dados pessoais e salariais fora do modelo de acesso da aplicação e fora de qualquer auditoria.
5. **Contas de tablet partilhadas com role `operator` (12)**: o role é da linha, não da pessoa. Tudo o que `operator` alcança — `wo.create`, `production.manage`, `production.target.view`, `chat.dm`, `chat.line` — é alcançável por quem estiver junto ao tablet, sem identidade individual. O PIN só protege o scorecard do líder.

Complementos: `shift_passwords` sem policies, e `has_action` na base de dados só é usada por `correct_downtime_event` — as restantes acções sensíveis dependem da verificação do cliente mais das policies genéricas.

## O que proponho a seguir

Quando quiseres avançar, o passo seguinte é um plano de execução em três frentes: (a) dar `requiredAction` a todas as rotas para que a matriz passe a ser a única autoridade, (b) fechar `USING (true)` nas tabelas de avaliação de pessoas e decidir o destino das tabelas de backup, (c) redesenhar `navItems` a partir dos perfis finais. Diz-me quais os perfis que queres manter e desenho isso.
