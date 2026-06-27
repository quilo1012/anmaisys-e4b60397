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

---

## Como usar
- **Recriação total**: cole o prompt acima em um projeto Lovable novo. Pode ser longo demais para uma única mensagem — divida em blocos (Auth → Manutenção → Produção → iTouching → Dashboards → Relatórios) se necessário.
- **Onboarding/documentação**: use como overview executivo no `README.md` do repositório.
- **Auditoria**: cada seção é uma checklist para validar o que está em produção.

Se quiser, posso gerar também versões **resumida (1 parágrafo)** ou **dividida em prompts sequenciais** (um por módulo) para reaplicar incrementalmente.