# AN Maintenance — Enterprise Audit Checklist

> Checklist segmentado por módulos para validar 100% do sistema antes de declarar "Production Ready".
> Marque `[x]` ao validar. Reporte qualquer falha na seção **Notas de Auditoria** ao final.
> Prompt completo de especificação: [`.lovable/plan.md`](./plan.md)

---

## Resumo Executivo

| Módulo                  | Total | Aprovados | Reprovados | Status |
| ----------------------- | ----- | --------- | ---------- | ------ |
| 1. Auth & RBAC          |  24   |           |            |        |
| 2. Work Orders          |  30   |           |            |        |
| 3. Inventory            |  16   |           |            |        |
| 4. Dashboards           |  28   |           |            |        |
| 5. Alertas & Notificações |  18 |           |            |        |
| 6. Integrações          |  26   |           |            |        |
| **TOTAL**               | **142** |         |            |        |

Sistema só é **Production Ready** quando todos os módulos estão 100% aprovados e nenhuma falha crítica permanece aberta.

---

## 1. AUTH & RBAC

### 1.1 Fluxos de Login
- [x] Login email+senha funciona para Admin, Manager, Engineer, Operator — `/login`
- [x] Silent re-login em tablet após refresh (refresh_token em `localStorage.an_tablet_cred`)
- [x] PIN engineer válido autentica em <2s — Edge Function `verify-engineer-pin`
- [x] PIN inválido bloqueia após N tentativas — tabela `pin_attempts`
- [x] Logout explícito wipa `an_tablet_cred` e redireciona para `/login`
- [x] Conta desativada (`profiles.active=false`) força sign-out em <5s via realtime

### 1.2 Sessão & Tokens
- [x] Refresh token rotaciona a cada 5 min (keep-alive em `AuthContext`)
- [x] Mudança de aba (visibility change) NÃO causa sign-out espúrio
- [x] Boot inicial tem timeout de 5s para silent re-login
- [x] `getClaims(token)` via JWKS retorna 401 com token inválido
- [x] Endpoints cron aceitam header `x-cron-secret` (CRON_SECRET env)

### 1.3 RBAC — Matriz Role × Rota
- [x] Admin acessa `/users`, `/audit-logs`, `/financial`, `/intouch-settings`
- [x] Manager NÃO acessa `/users` (redirect ou Access Denied)
- [x] Engineer só acessa `/engineer`, `/work-orders/*`
- [x] Operator só acessa `/operator`, `/work-orders/*` (sem "View target")
- [ ] Viewer é read-only em todos os dashboards permitidos
- [x] RLS bloqueia leitura cruzada (testar SELECT direto via SQL com role anon)
- [x] `has_role(_user_id, _role)` SECURITY DEFINER sem EXECUTE para anon

### 1.4 Edge Function Auth
- [x] `log-audit-event` aceita JWT válido, rejeita ausente
- [x] `intouch-poll` aceita cron secret OR admin JWT
- [x] `delete-user` somente admin (manager/engineer = 403)
- [x] Todas Edge Functions têm Zod validando body e CORS configurado
- [x] Nenhuma Edge Function loga `SUPABASE_SERVICE_ROLE_KEY` ou secrets
- [x] `tablet-signin` rate-limited por IP/conta

---

## 2. WORK ORDERS

### 2.1 Lifecycle
- [x] Criar WO via Operator Panel (campos opcionais permitidos)
- [x] Criar WO retroativa com data manual passada
- [x] Iniciar WO (PIN engineer obrigatório)
- [x] Pausar WO com `pause_reason` obrigatório
- [x] Retomar WO pausada (timer continua de onde parou)
- [x] Finalizar WO (cria `machine_events` row)
- [x] Fechar WO finalizada
- [x] Reabrir WO como recorrência (`reopen_wo_as_recurrence` reusa mesmo `wo_number`, incrementa `wo_episode`)
- [x] Force Action (admin) com confirm dialog grava em audit log
- [x] Numeração `WO-YYYY-000XXX` sequencial sem gaps

### 2.2 Engineer Workflow
- [x] PIN persiste em sessionStorage durante a sessão
- [x] Live timer auto-atualiza tempo decorrido (segundos)
- [x] Upload de foto comprime para ~1MB, salva em bucket `wo-photos`
- [x] Foto carrega via Signed URL (não pública)
- [x] Assinatura touch (canvas) salva como base64/blob
- [x] Adicionar peça deduz estoque automaticamente (FIFO)
- [x] Bloqueio quando saldo de peça = 0

### 2.3 SLA & Alertas
- [x] SLA Low=2h, Medium=1h, High=30m, Critical=10m
- [x] Default ao criar = Medium
- [x] WO em "In Progress" há >72h ganha badge laranja "Stale"
- [x] Auto-shift filter em `/work-orders` baseado no relógio London (BST/GMT)
- [x] Filtro persiste durante a navegação dentro do shift atual

### 2.4 Outros
- [x] PDF gerado via `generate-wo-pdf-auth` contém todos os campos + fotos
- [x] Audit log registra cada transição de status (`work_order_logs`)
- [x] Cascading delete remove `wo_messages`, `wo_photos`, `wo_pauses`, `parts_used`
- [x] Tempo total formatado como "Xh Ym" (helper `formatDuration`)

---

## 3. INVENTORY

### 3.1 Stock
- [x] FIFO: usar peça deduz primeiro o lote mais antigo
- [x] Dedução automática ao adicionar `parts_used` em WO
- [x] Bloqueio com mensagem clara quando saldo zero
- [x] Histórico de movimentações lista used/added/adjusted com timestamps
- [x] Preços visíveis SOMENTE para admin (testar com manager)
- [x] Low stock notification dispara abaixo do `min_qty`

### 3.2 Suppliers & Purchase Orders
- [x] CRUD completo de suppliers
- [x] Criar PO com múltiplos itens e fornecedor
- [ ] Status PO (draft → submitted → received) avança corretamente
- [ ] Receber PO atualiza saldo de estoque
- [x] Hook `useSuppliers` invalida cache após mutação

### 3.3 Exportação
- [x] Excel semanal gerado via `export-weekly-excel` (exceljs)
- [ ] Arquivo abre no Excel sem erros de formato
- [x] Colunas: data, peça, qty, custo, WO ref, supplier
- [x] Botão "Export" visível só para admin/manager
- [x] Download direto (sem necessidade de email)

---

## 4. DASHBOARDS

### 4.1 Manager Dashboard
- [ ] KPIs SLA Compliance, MTTR, MTBF carregam em <2s
- [ ] Card "RAG Today live" atualiza em realtime
- [ ] Status colors realtime (engineer ativo/idle/offline)
- [ ] Botões "View WO" navegam corretamente

### 4.2 Engineer Dashboard
- [ ] Lista de WOs assigned + open aparece ordenada por severidade
- [ ] Mobile/Tablet (≤1024px) usa sidebar Sheet drawer
- [ ] Cards h-14 com toque fácil
- [ ] Live timer em cada WO ativa

### 4.3 Operator Dashboard
- [ ] Exibe APENAS Work Orders (sem "View target", sem hub de alertas)
- [ ] Toggle "Machine Stopped" compacto funciona
- [ ] Botão "New Problem" abre dialog mínimo

### 4.4 Executive / Control Center / Financial
- [ ] Executive: filtros data + turno aplicam corretamente
- [ ] TV Mode em fullscreen sem barras de scroll
- [ ] Control Center: mapa fabril realtime, drag-drop de zonas, status visual
- [ ] Financial (admin): labor cost calculado por WO finalizada, valor de inventário correto
- [ ] Reliability Dashboard: MTTR/MTBF por máquina, ranking de risco LOW/MEDIUM/HIGH

### 4.5 Analytics
- [ ] "Machines with Most Downtime" BarChart stacked por turno
- [ ] Tooltip exibe nome da linha
- [ ] Range filter (Today/7d/30d/90d) funciona

### 4.6 Downtime Heatmap
- [ ] Presets Today, Current shift, 7d, 30d, 90d, Custom range
- [ ] Range selecionado persiste em localStorage após refresh
- [ ] Custom range com 2 date pickers (start/end)
- [ ] Células coloridas refletem intensidade de downtime
- [ ] Hover mostra detalhes

### 4.7 Layout Geral
- [ ] Sidebar colapsível h-screen com scroll independente
- [ ] Group labels uppercase, escondidos para engineers
- [ ] Sem hardcoded text-white/bg-black (usar tokens semânticos)
- [ ] Dark theme consistente em todas as rotas

---

## 5. ALERTAS & NOTIFICAÇÕES

### 5.1 Sirene Crítica (CriticalAlertContext)
- [ ] Sirene toca UMA VEZ por WO (testado em `woAlertGate.test.ts`)
- [ ] Filtro de linha por engineer: vazio = todas; `line_id=null` sempre alerta
- [ ] Volume slider 0-100% persiste em localStorage
- [ ] Toggle On/Off funciona
- [ ] Botão "Test Siren" reproduz som de teste
- [ ] Re-unlock fallback: após autoplay bloqueado, primeiro clique resume sirene

### 5.2 Push & Bell
- [ ] Service Worker `public/sw.js` registra com sucesso
- [ ] Push notification recebida em desktop e mobile
- [ ] Clique no push abre deep link para WO
- [ ] Bell badge mostra contagem realtime
- [ ] Notifications Center lista histórico ordenado

### 5.3 Canais Externos
- [ ] Teams webhook envia mensagem formatada sem HTML injection
- [ ] Email Resend entrega Daily RAG Report
- [ ] Email Resend entrega Shift Report
- [ ] Falha de envio é logada em `teams_webhook_logs`
- [ ] Retries com backoff em falha transitória

### 5.4 Triggers
- [ ] `requires_wo=true` no stop code dispara push + bell + sirene
- [ ] Low stock dispara notificação para admin
- [ ] WO crítica nova alerta engineers do turno

---

## 6. INTEGRAÇÕES

### 6.1 iTouching Polling
- [ ] Cron `intouch-poll` ativo (a cada 10s, escalonado)
- [ ] Autenticação via `x-cron-secret` OR admin JWT
- [ ] Cria WO automática SOMENTE em transição real de stop code
- [ ] Stop codes com `requires_wo=true`: Maintenance Issue + sub-códigos, Metal Detector Checks
- [ ] Janela de 4h previne WOs duplicadas para mesma máquina
- [ ] Baseline limpa quando última WO da máquina é fechada
- [ ] Não cria SKU automaticamente

### 6.2 iTouching Sync Produção
- [ ] Cron 06:30 e 18:30 (London) dispara `intouch-sync-production`
- [ ] Cron a cada 5 min sincroniza actuals
- [ ] Toggle "Disable current-shift sync" default = ON
- [ ] Puxa actual_qty, scrap_qty, run_time, down_time, oee
- [ ] Botão "Sync now" força sincronização imediata
- [ ] Tabela `intouch_sync_runs` registra status de cada execução

### 6.3 iTouching Machines & SKUs
- [ ] `intouch-list-machines` retorna GUIDs corretos
- [ ] "Auto-map all machines" mapeia via Jaccard similarity
- [ ] `intouch-list-products` com fallback para `production_items`
- [ ] Import XLSX usa headers exatos do iTouching, calcula `target_per_hour`
- [ ] SKU Sync Diagnostics polling visibility-aware (30s/120s)

### 6.4 iTouching Webhook
- [ ] `intouch-webhook` resolve Line Leader ativo como `requested_by`
- [ ] Payload validado com Zod
- [ ] Logado em `intouch_webhook_logs`

### 6.5 RAG Weekly Sync
- [ ] Trigger `trg_sync_rag_actual` soma `production_items.actual_qty` → `rag_weekly_entries.actual_qty`
- [ ] Trigger `trg_sync_items_target_from_rag` faz auto-rescale de targets
- [ ] Edição inline (admin) atualiza em <1s via realtime
- [ ] Downtime no RAG referencia WO # com badge de status
- [ ] Aviso ⚠ de arredondamento quando soma SKU ≠ total da linha
- [ ] Toggles diários/turno via `rag_week_exclusions` excluem do cálculo

### 6.6 Outras Integrações
- [ ] SharePoint import via `sharepoint-download-file` Edge Function
- [ ] `calculate-shift-targets` recalcula targets por SKU (660 min/turno)
- [ ] Todos os cron jobs estão ativos (verificar `cron.job`)
- [ ] Nenhum cron job em loop infinito

---

## Notas de Auditoria

Use esta seção para registrar achados durante a auditoria.

### Bugs Encontrados
| # | Módulo | Severidade | Arquivo:Linha | Descrição | Status |
|---|--------|------------|---------------|-----------|--------|
|   |        |            |               |           |        |

### Vulnerabilidades de Segurança
| # | Tipo (OWASP/CWE) | Severidade | Localização | Descrição | Correção |
|---|------------------|------------|-------------|-----------|----------|
|   |                  |            |             |           |          |

### Problemas de Performance
| # | Tipo | Localização | Métrica observada | Meta | Plano |
|---|------|-------------|-------------------|------|-------|
|   |      |             |                   |      |       |

### Melhorias Sugeridas
- [ ] ...

---

## Nota de Qualidade Final (0-100)

| Dimensão         | Nota | Justificativa |
| ---------------- | ---- | ------------- |
| Segurança        |      |               |
| Performance      |      |               |
| Arquitetura      |      |               |
| Escalabilidade   |      |               |
| Confiabilidade   |      |               |
| Código           |      |               |
| UX               |      |               |
| Banco de Dados   |      |               |
| APIs             |      |               |
| **Sistema Geral**|      |               |

> O sistema só é **Production Ready** com Sistema Geral ≥ 85 e nenhuma falha crítica aberta.
