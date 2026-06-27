# Prompt de Recriação — AN Maintenance & Production System

Abaixo está um prompt único, pronto para colar em uma nova sessão Lovable, descrevendo **em detalhe** tudo o que o sistema atual faz. Use-o como referência para recriar/clonar o app ou para onboarding técnico.

---

## PROMPT (copiar a partir daqui)

> Quero construir um sistema integrado de **Manutenção Industrial + Produção (OEE/RAG)** para uma fábrica farmacêutica/cosmética, em **React 18 + Vite + TypeScript + Tailwind + shadcn-ui** no frontend e **Lovable Cloud (Supabase: Postgres + Auth + Edge Functions + Storage + Realtime + pg_cron)** no backend. Tema **dark by default**, Inter font, primária Azul `#1978E5`, alertas Âmbar. Cores de role: Admin (vermelho), Manager (roxo), Engineer (azul), Operator (cinza). Idioma padrão: Inglês, com suporte parcial PT‑BR. Layout tátil, botões `h-14`, autofill desativado globalmente. Fuso horário operacional: **Europe/London** (BST/GMT dinâmico).
>
> ### 1. Autenticação, Roles e Segurança
> - Roles via tabela separada `user_roles` + enum `app_role` (`admin`, `manager`, `engineer`, `operator`, `viewer`) e função `has_role(_user_id, _role)` `SECURITY DEFINER`.
> - **RBAC estrito**: Admin (tudo), Manager (operação + relatórios + edição RAG/Performance), Engineer (WOs + alertas), Operator (linha + WOs).
> - **Identidade híbrida**: login compartilhado por tablet + **PIN individual** validado por Edge Function (`verify-engineer-pin`, bcrypt).
> - **Tablet silent re-login**: refresh_token persistido em `localStorage` (`an_tablet_cred`), com fallback automático após `SIGNED_OUT` implícito; timeout 5s para nunca travar o boot.
> - **Bloqueio de conta desativada** via realtime em `profiles.active=false` (sign-out forçado).
> - Edge Functions usam **`getClaims(token)` (JWKS local)** em vez de `getUser()` para evitar `invalid_token` 401.
> - Cron jobs autenticam via header `x-cron-secret` (`CRON_SECRET` env) — endpoints aceitam ou JWT admin/manager OR cron.
> - RLS habilitada em todas as tabelas `public`, com `GRANT` explícito a `authenticated`/`service_role`; `anon` apenas onde realmente público. `EXECUTE` revogado de `anon` para funções SECURITY DEFINER. Validação Zod em toda Edge Function.
> - Auditoria V2: tabela `audit_logs` registrando login, alterações de WO, mudanças de role, edição de `actual_qty`, etc., via trigger `trg_log_production_item_actual_change` e função `log-audit-event`.
>
> ### 2. Manutenção (Work Orders)
> - Tabela `work_orders` com numeração padrão **WO-YYYY-000XXX**, status (Open → In Progress → Paused → Finished → Closed), severidade (Low/Med/High/Critical) e **SLA** (2h/1h/30m/10m, default Medium).
> - **Operator Panel**: criar WO com `requested_by` opcional, observações em largura total, campos opcionais; ordens **retroativas** com data manual.
> - **Engineer Mobile**: cards grandes, focus mode, fotos opcionais, assinatura touch, **live timer** auto-atualizando o tempo decorrido, **PIN persistido em sessionStorage**.
> - **Pause traceability**: `pause_reason` obrigatório.
> - **Force Action** (admin): override de status com confirm dialog e log.
> - **Stale WO**: ordens "In Progress" há >72h ganham badge laranja.
> - Recurrence: `reopen_wo_as_recurrence` reabre o **mesmo `wo_number`** acumulando `wo_episode` e tempo total.
> - **WO Cascading Deletion**: DB cascade + cleanup manual.
> - Fotos privadas em bucket `wo-photos` com **Signed URLs**.
> - **Time Management**: tudo formatado como "Xh Ym" via `formatDuration`/`formatMinutes`.
> - **Auto-shift filter** em `/work-orders` baseado no relógio London.
>
> ### 3. Alertas Sonoros (CriticalAlertContext)
> - Sirene industrial + chime para WOs críticas, deep-link no clique.
> - Gating em `src/lib/woAlertGate.ts` (testado): toca **uma única vez por WO**, respeita filtro de linha por engenheiro, status e turno ativo.
> - **AudioStatusButton**: popover com On/Off, slider de volume 0–100%, botão "Test Siren". Persistência em localStorage.
> - **Re-unlock fallback**: listener global de interação resume sirene se autoplay foi bloqueado.
> - Engineer Alert Line Filter: vazio = todas as linhas; `line_id=null` sempre alerta.
>
> ### 4. Estoque e Compras
> - **FIFO**, dedução automática ao usar peça em WO; saldo zero **bloqueia** uso; **preços visíveis só para admin**.
> - Histórico completo de movimentações (used/added/adjusted).
> - **Suppliers** + **Purchase Orders** (CRUD).
> - **Excel Export semanal** via Edge Function `export-weekly-excel` (exceljs).
>
> ### 5. Máquinas, Confiabilidade e Predição
> - `machines` (nome obrigatório), Health Score por trigger, **machine_location_log** + sync de status.
> - **QR Codes** com URL para histórico ou nova WO.
> - **Machine Events** logados em FINISH de WO.
> - **Risk Engine** (LOW/MEDIUM/HIGH) por frequência de falhas; **Predictive v2** com MTBF e alertas visuais.
> - **Reliability Dashboard** (MTTR, MTBF, ranking de risco).
> - **PM Intelligence**: agendamento preventivo baseado em MTBF real.
> - **Downtime Module v2**: tracking separado de paradas, hora inicial manual; cron fecha eventos abertos do turno anterior.
> - **Downtime Heatmap** com presets (Today, Current shift, 7d, 30d, 90d, **Custom range**) **persistidos em localStorage**.
>
> ### 6. Produção, OEE e RAG Weekly
> - **Production Planner**: importação CSV/XLSX via `exceljs` (`ImportProductionDialog`), derivação de turno, "Sync Lines" puxando linhas distintas de `intouch_work_to_list`, auto-upsert de `totalPlan` em `rag_weekly_entries`.
> - **SKU Products**: import XLSX no formato exato do iTouching, cálculo `target_per_hour`, delete com FK `ON DELETE SET NULL`.
> - **Production Sessions/Items** com 660 min produtivos/turno; Edge Function `calculate-shift-targets` recalcula targets por SKU.
> - **RAG Weekly** (matriz colorida estilo SharePoint): edição inline (admin), date picker no header, "Manage Lines", **toggles diários/turno** via `rag_week_exclusions`, downtime automático integrado às WOs com **popover de detalhamento** (Ref WO # com badges de status, ⚠ aviso de arredondamento), realtime updates, importação SharePoint via Edge Function `sharepoint-download-file`.
> - Trigger `trg_sync_rag_actual` soma `production_items.actual_qty` → `rag_weekly_entries.actual_qty`. Trigger `trg_sync_items_target_from_rag` faz auto-rescale dos targets de SKU quando RAG muda.
> - **Production Performance** (admin/manager edita inline; target vem de `production_items.target_qty`; ordenação `lineRank`: Line 1→7, Capsules, Gel).
> - **Production Forecast** (ETA por UPM).
> - **Quality Actions**, **Shift History** (edição de SKU com botão delete + dialog de edição de `actual_qty`).
> - **SKU Efficiency** dashboard.
>
> ### 7. Integração iTouching (MES externo)
> - **`intouch-poll`** (cron a cada 10s, escalonado): cria WO automática em transições reais de stop code com `requires_wo=true` (Maintenance Issue + sub-códigos, Metal Detector Checks). Janela de 4h evita duplicatas. Limpa baseline quando última WO da máquina é fechada. Aceita JWT admin OR `x-cron-secret`.
> - **`intouch-webhook`** resolve o **Line Leader ativo** como `requested_by`.
> - **`intouch-sync-production`** (06:30/18:30 + a cada 5 min para actuals): puxa `actual_qty`, `scrap_qty`, `run_time`, `down_time`, `oee`. Toggle "Disable current-shift sync" **default ON**.
> - **`intouch-list-machines`** + **Auto-map all machines** via similaridade de Jaccard.
> - **`intouch-list-products`** com fallback para `production_items`.
> - **`IntouchSettingsPage`**: stop code mapping, GUIDs, **SKU Sync Diagnostics** com polling visibility-aware (30s foreground / 120s background) e botão **Sync now**.
> - Tabela `intouch_sync_runs` para status dashboard.
>
> ### 8. Notificações
> - **Notifications Center** realtime: alertas de WO, sirenes industriais, chimes, low stock warnings.
> - **Push notifications** (service worker `public/sw.js`).
> - Engineers recebem push + bell + deep link quando `requires_wo=true` dispara.
>
> ### 9. Dashboards
> - **Executive Dashboard** (Director KPIs, TV Mode, filtros por data **e turno**, impact rankings).
> - **Manager Dashboard** (SLA Compliance, status realtime, **RAG Today live summary card**).
> - **Engineer Dashboard** (mobile-first, sidebar drawer em ≤1024px).
> - **Operator Dashboard** (apenas Work Orders — sem "View target", sem hub de alertas).
> - **Control Center** (mapa fabril realtime, TV mode, drag-drop, zonas visuais).
> - **Financial Dashboard** (admin: labor cost, valor de inventário).
> - **Analytics**: Machines with Most Downtime (BarChart stacked por turno + linha).
>
> ### 10. Relatórios e Integrações Externas
> - **Daily RAG Report** (substituiu Weekly Report): Edge Function `send-daily-rag-report` via Resend + Teams webhook.
> - **Shift Report** por email (`send-shift-report`).
> - **Teams notifications** (`notify-teams`, sem HTML injection).
> - **Impressão profissional** com cabeçalho corporativo, margem reset, fluxo contínuo de páginas.
> - **PDF generator** para WOs (`generate-wo-pdf-auth`).
>
> ### 11. UI/UX Diretrizes
> - Sidebar colapsível `h-screen`, scroll independente; labels minúsculas uppercase com `letter-spacing`; labels escondidos para engineers (poucos itens).
> - Dialogs **async-safe** (await mutation antes de fechar).
> - Optimization: refetch 30s, image compression ~1MB, estado offline em `useOfflineQueue`.
> - Realtime channels com IDs únicos para evitar erros de subscription.
> - Radix Select: usar `"none"` como fallback em vez de string vazia.
> - `useEffect` com dependências corretas; sem hardcoded `text-white`/`bg-black` (usar tokens semânticos em `index.css`).
>
> ### 12. Testes
> - Vitest: `permissions.test.ts`, `downtimeReliability.test.ts`, `ragDowntime.test.ts`, `ragTargetSplit.test.ts` (8 testes), `woAlertGate.test.ts` (9 testes), `wo-buttons-a11y.test.tsx`, `lib.test.ts`.
> - CI: `.github/workflows/ci.yml` + coverage workflow para downtime/reliability.
>
> Quero todas essas funcionalidades implementadas com migrations completas (com GRANT em todas as tabelas públicas + RLS + policies), Edge Functions com CORS + Zod + JWKS, e UI dark profissional.
>
> ---
>
> ## ENTERPRISE PRODUCTION AUDIT — MANDATORY VALIDATION
>
> Antes de considerar qualquer tarefa concluída, execute uma **auditoria técnica completa** do sistema. **Não assuma que uma funcionalidade funciona apenas porque existe código** — toda funcionalidade deve ser validada de ponta a ponta, sem erros funcionais, de integração, de segurança ou de performance.
>
> ### Full System Audit — verifique 100% do projeto
>
> **Frontend**: todas as páginas carregam sem erros JS; nenhum componente quebra; todos os formulários, botões, dialogs, drawers, modais, popovers, dropdowns, atalhos, gráficos, tabelas, filtros, pesquisas, exportações, impressões, uploads, imagens e QR Codes funcionam.
>
> **Navegação**: validar TODAS as rotas — nenhuma pode retornar 404, 500, tela branca, infinite loading ou redirect loop. Verificar sidebar, menus, breadcrumbs e deep links.
>
> **Authentication**: login, logout, silent login, tablet login, PIN login, refresh token, session restore, token expiration, role switching, disabled users, realtime sign out.
>
> **RBAC**: validar cada Role (Admin, Manager, Engineer, Operator, Viewer) — páginas, menus, APIs, Edge Functions e permissões. Nenhum usuário pode acessar recursos indevidos.
>
> **Work Orders**: criar, editar, iniciar, pausar, retomar, finalizar, fechar, reabrir, recorrência, force action, fotos, assinatura, timer, SLA, alertas, PDF, auditoria, machine events, downtime, notificações.
>
> **Inventory**: FIFO, dedução automática, saldo, bloqueio sem estoque, histórico, Purchase Orders, Suppliers, Excel.
>
> **Machines**: CRUD, Machine Health, Risk Engine, Predictive, MTBF, MTTR, Reliability, QR Codes, Downtime, Heatmap, PM Intelligence.
>
> **Production**: Planner, Import CSV, Import XLSX, SKU, Production Sessions, Production Items, Shift Targets, Performance, Forecast, Quality, Shift History, SKU Efficiency.
>
> **RAG Weekly**: validar completamente — todas as linhas, dias e turnos, realtime, inline edit, exclusões, downtime, popovers, badges, totalizadores, gatilhos, sincronização, recálculo, atualizações automáticas. **Verificar consistência matemática.**
>
> **iTouching**: Settings, Machine Mapping, Stop Codes, Polling, Webhook, Production Sync, Machine Sync, SKU Sync, Diagnostics, Health Status, Cron Jobs, Auto Mapping, Actual Quantity, OEE, Runtime, Downtime, Scrap.
>
> **APIs**: testar TODAS — status HTTP, payload, timeout, retries, autorização, JWT, Cron Secret, CORS, Zod, logs.
>
> **Edge Functions**: executar todas; nenhuma pode falhar. Verificar timeout, erros, logs, performance, memory.
>
> **Database**: todas as tabelas, foreign keys, triggers, indexes, constraints, views, policies, RLS, functions, GRANTs, realtime, cron.
>
> **Storage**: buckets, signed URLs.
>
> **Security**: auditoria baseada em **OWASP Top 10 / CWE / SANS** — SQL Injection, XSS, CSRF, SSRF, IDOR, JWT, secrets, storage, permissions, RLS, CORS, headers, rate limits, audit logs.
>
> **Performance**: queries lentas, N+1, bundle size, lazy loading, memory, CPU, realtime, polling, renderizações, cache.
>
> **Tests**: executar todos os testes existentes; criar testes ausentes; não permitir regressões.
>
> **Code Quality**: detectar code smells, dead code, duplicações, violações SOLID, clean architecture, complexidade, acoplamento.
>
> ### Auditoria Final — Relatório obrigatório
>
> Gerar relatório contendo: Status Geral do Sistema, Funcionalidades Aprovadas, Funcionalidades Reprovadas, Bugs encontrados, Vulnerabilidades, Problemas de Performance / Segurança / UX / Integração / Banco / Edge Functions / iTouching / RAG Weekly / Work Orders / Dashboards, Melhorias sugeridas.
>
> **Para cada problema informar**: Severidade · Arquivo · Linha · Causa · Impacto · Correção · Diff aplicado.
>
> **Nota de qualidade 0–100** para: Segurança · Performance · Arquitetura · Escalabilidade · Confiabilidade · Código · UX · Banco de Dados · APIs · Sistema Geral.
>
> O sistema **somente poderá ser considerado "Production Ready"** se nenhuma falha crítica permanecer aberta.

---

## Como usar
- **Recriação total**: cole o prompt acima em um projeto Lovable novo. Pode ser longo demais para uma única mensagem — divida em blocos (Auth → Manutenção → Produção → iTouching → Dashboards → Relatórios) se necessário.
- **Onboarding/documentação**: use como overview executivo no `README.md` do repositório.
- **Auditoria**: cada seção é uma checklist para validar o que está em produção.

Se quiser, posso gerar também versões **resumida (1 parágrafo)** ou **dividida em prompts sequenciais** (um por módulo) para reaplicar incrementalmente.