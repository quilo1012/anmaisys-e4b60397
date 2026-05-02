
# Plano: Tablet Layout + Sirene Engenheiro + Sessão estável

## 1. Sessão: parar de deslogar sozinho ao navegar entre páginas

**Causa raiz confirmada lendo o código:**
- Em tablets compartilhados, o token de refresh do Supabase é rotacionado. Quando outra aba/tablet refresca, o tablet atual recebe `SIGNED_OUT` (token revogado).
- Já existe um `tryTabletRelogin()` no `AuthContext`, mas durante a janela em que ele está em curso, o `ProtectedRoute` enxerga `session = null` e redireciona instantaneamente para `/login` — então quando o silent re-login termina, o usuário já saiu da página.
- Sintoma também aparece quando `fetchUserData` zera `role` durante refetch e `loading` fica `true` por uma fração de segundo, mas o redirect já foi disparado.

**Correções:**

a) **AuthContext.tsx**
   - Manter `session` e `role` antigos durante a tentativa de silent relogin (não limpar imediatamente em `SIGNED_OUT` implícito).
   - Adicionar flag `silentReLoginInFlight` exposta no contexto.
   - Em `fetchUserData`, **nunca zerar** `role`/`profile` antes de receber a nova resposta — só substituir.
   - No `forceSignOutInactive`, manter o comportamento atual (esse é explícito).

b) **ProtectedRoute.tsx**
   - Quando `!session` E `silentReLoginInFlight === true` → mostrar spinner em vez de `<Navigate to="/login" />`.
   - Adicionar grace period de 3s: se há credenciais de tablet salvas (`an_tablet_cred`), aguardar até 3s antes de redirecionar para login.

c) **Login.tsx**
   - Quando o login da tablet é bem-sucedido, redirect baseado no role já implementado — só garantir que limpa a flag `an_account_deactivated_until` numa nova autenticação manual.

## 2. Sirene crítica em TODO login de engenheiro

**Estado atual:** o prompt "Enable Alerts" só aparece após o primeiro click/keydown no documento (em `useWOAlerts.ts`) e depois do mount do `EngineerDashboard`. Se o engenheiro ficar parado em outra rota (ex.: `/dashboard/work-orders`), o áudio pode nunca ser desbloqueado e a sirene falha silenciosamente.

**Correções:**

a) **DashboardLayout.tsx (ou novo componente AlertAudioGate)**
   - Para roles `engineer` e `admin`: assim que o layout monta com role definido, chamar `promptEnableAudio()` automaticamente se `audioEnabled === false`.
   - Isso garante que **toda página** dentro do dashboard (não apenas `/dashboard/engineer`) força o desbloqueio.

b) **useWOAlerts.ts**
   - Quando uma WO crítica chega e `audioEnabled === false`, além de chamar `promptEnableAudio()`, também tentar `engineRef.current?.unlock()` + `start()` mesmo sem gesto — o `AlertAudioEngine` já tem fallback de oscillator + vibration que funciona em alguns navegadores sem unlock prévio. Isso aumenta a chance de tocar mesmo se o engineer ignorou o prompt.
   - **Adicionar fallback persistente:** se houver WO crítica em `open` com `engineer_notified_acknowledged_at IS NULL` para esta engineer (ou sem assignee), re-disparar o `triggerAlert` ao remontar o hook (já parcialmente implementado — vamos garantir cobertura).

c) **AudioStatusButton (header)**
   - Já existe e fica vermelho/pulsando quando muted. Vamos torná-lo mais visível para engineers: badge "AUDIO OFF" textual ao lado do ícone quando `!audioEnabled` e role = engineer/admin.

## 3. Layout responsivo tablet (1280×800 paisagem) — todas as páginas

**Páginas auditadas e ajustes:**

| Página | Problema observado | Ajuste |
|---|---|---|
| `Login.tsx` | Card centralizado pequeno em tablet | `max-w-md md:max-w-lg`, padding maior, h-14 nos inputs/botões |
| `OperatorDashboard.tsx` | Tabela "My Work Orders" com colunas Line/Machine vazias e espaço lateral desperdiçado (img2) | Container `max-w-7xl mx-auto`; tabela com `min-w-[900px]` em scroll horizontal apenas se necessário; coluna Line resolvida via `line_id` (já feito) |
| `WorkOrderDetail.tsx` (Line Stop & Resume History) | Coluna "Type" cortada ("Recu...") com half-screen vazio à direita (img1) | Mover histórico para usar largura total (`w-full`), não duas colunas; aumentar largura mínima da coluna Type; remover gap lateral |
| `EngineerDashboard.tsx` | Cards mobile-first OK, mas em tablet horizontal subutiliza espaço | Grid `grid-cols-1 md:grid-cols-2` para WO cards; KPI row em `md:grid-cols-4` |
| `ManagerDashboard.tsx` | Já responsivo, revisar SLA cards | Garantir `md:grid-cols-3 lg:grid-cols-4` consistente |
| `WorkOrdersPage.tsx`, `MachinesPage.tsx`, `StockPage.tsx`, `ProblemsPage.tsx` | Tabelas overflow horizontal sem indicação | Wrapper com `overflow-x-auto` e sticky header |
| `AnalyticsPage.tsx`, `ReliabilityDashboard.tsx`, `ExecutiveDashboard.tsx` | Charts responsivos OK; ajustar grid de KPIs | `md:grid-cols-2 lg:grid-cols-4` |
| `DashboardLayout.tsx` | Sidebar fixa em tablet ocupa muito | Sidebar collapsa por padrão em viewport `<1024px`, expandida em `>=1280px` |
| `ControlCenterPage.tsx` | Mapa pode estourar | `max-h-[calc(100vh-12rem)]` e `overflow-auto` |

**Quebras de layout específicas das fotos:**
- **img1** (Line Stop & Resume History): tabela está dentro de uma `Card` com `w-full` mas o pai tem `grid-cols-2` herdado — precisa `col-span-full`. A coluna Type precisa de `whitespace-nowrap min-w-[120px]`.
- **img2** (Operator panel): Form de criação está em `max-w-3xl` num container `max-w-7xl`, deixando metade da tela vazia. Mudar para `lg:grid-cols-[1fr_auto]` agrupando criar-WO + insights AI lado-a-lado, ou usar `max-w-5xl` centralizado.

## Arquivos a editar

1. `src/contexts/AuthContext.tsx` — silent re-login flag, no clearing
2. `src/components/ProtectedRoute.tsx` — grace period, spinner durante re-login
3. `src/components/DashboardLayout.tsx` — AudioGate integrado, sidebar responsiva
4. `src/hooks/useWOAlerts.ts` — fallback unlock automático, re-trigger em mount
5. `src/components/AudioStatusButton.tsx` — badge "AUDIO OFF" visível
6. `src/pages/Login.tsx` — tamanhos tablet
7. `src/pages/dashboard/OperatorDashboard.tsx` — layout tabela + form
8. `src/pages/dashboard/WorkOrderDetail.tsx` — Line Stop History full-width
9. `src/pages/dashboard/EngineerDashboard.tsx` — grid tablet
10. `src/pages/dashboard/ManagerDashboard.tsx`, `WorkOrdersPage.tsx`, `MachinesPage.tsx`, `StockPage.tsx`, `ProblemsPage.tsx`, `AnalyticsPage.tsx`, `ReliabilityDashboard.tsx`, `ExecutiveDashboard.tsx`, `ControlCenterPage.tsx`, `DowntimePage.tsx`, `MachineHistoryPage.tsx` — ajustes de breakpoints/grids

## Fora de escopo
- Mudanças no esquema do banco
- Refator do fluxo de PIN/autenticação híbrida
- Mudanças no chat/checklists (removidos permanentemente)

**Pronto para aplicar quando você aprovar.**
