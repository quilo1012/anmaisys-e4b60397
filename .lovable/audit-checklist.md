# AN Maintenance — Enterprise Audit Checklist

> Checklist segmentado por módulos para validar 100% do sistema antes de declarar "Production Ready".
> Marque `[x]` ao validar. Reporte qualquer falha na seção **Notas de Auditoria** ao final.
> Prompt completo de especificação: [`.lovable/plan.md`](./plan.md)

---

## Resumo Executivo

| Módulo                  | Total | Aprovados | Reprovados | Status |
| ----------------------- | ----- | --------- | ---------- | ------ |
| 1. Auth & RBAC          |  24   |    23     |     0      | ✅ 96% |
| 2. Work Orders          |  30   |    30     |     0      | ✅ 100% |
| 3. Inventory            |  16   |    13     |     0      | 🟡 81% |
| 4. Dashboards           |  28   |    28     |     0      | ✅ 100% |
| 5. Alertas & Notificações |  18 |    15     |     0      | 🟡 83% |
| 6. Integrações          |  26   |    26     |     0      | ✅ 100% |
| **TOTAL**               | **142** |  **135** |   **0**    | 🟢 95% |

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
- [x] KPIs SLA Compliance, MTTR, MTBF carregam em <2s
- [x] Card "RAG Today live" atualiza em realtime
- [x] Status colors realtime (engineer ativo/idle/offline)
- [x] Botões "View WO" navegam corretamente

### 4.2 Engineer Dashboard
- [x] Lista de WOs assigned + open aparece ordenada por severidade
- [x] Mobile/Tablet (≤1024px) usa sidebar Sheet drawer
- [x] Cards h-14 com toque fácil
- [x] Live timer em cada WO ativa

### 4.3 Operator Dashboard
- [x] Exibe APENAS Work Orders (sem "View target", sem hub de alertas)
- [x] Toggle "Machine Stopped" compacto funciona
- [x] Botão "New Problem" abre dialog mínimo

### 4.4 Executive / Control Center / Financial
- [x] Executive: filtros data + turno aplicam corretamente
- [x] TV Mode em fullscreen sem barras de scroll
- [x] Control Center: mapa fabril realtime, drag-drop de zonas, status visual
- [x] Financial (admin): labor cost calculado por WO finalizada, valor de inventário correto
- [x] Reliability Dashboard: MTTR/MTBF por máquina, ranking de risco LOW/MEDIUM/HIGH

### 4.5 Analytics
- [x] "Machines with Most Downtime" BarChart stacked por turno
- [x] Tooltip exibe nome da linha
- [x] Range filter (Today/7d/30d/90d) funciona

### 4.6 Downtime Heatmap
- [x] Presets Today, Current shift, 7d, 30d, 90d, Custom range
- [x] Range selecionado persiste em localStorage após refresh
- [x] Custom range com 2 date pickers (start/end)
- [x] Células coloridas refletem intensidade de downtime
- [x] Hover mostra detalhes

### 4.7 Layout Geral
- [x] Sidebar colapsível h-screen com scroll independente
- [x] Group labels uppercase, escondidos para engineers
- [x] Sem hardcoded text-white/bg-black (usar tokens semânticos)
- [x] Dark theme consistente em todas as rotas

---

## 5. ALERTAS & NOTIFICAÇÕES

### 5.1 Sirene Crítica (CriticalAlertContext)
- [x] Sirene toca UMA VEZ por WO (testado em `woAlertGate.test.ts`)
- [x] Filtro de linha por engineer: vazio = todas; `line_id=null` sempre alerta
- [x] Volume slider 0-100% persiste em localStorage
- [x] Toggle On/Off funciona
- [x] Botão "Test Siren" reproduz som de teste
- [x] Re-unlock fallback: após autoplay bloqueado, primeiro clique resume sirene

### 5.2 Push & Bell
- [x] Service Worker `public/sw.js` registra com sucesso
- [x] Push notification recebida em desktop e mobile
- [ ] Clique no push abre deep link para WO
- [x] Bell badge mostra contagem realtime
- [x] Notifications Center lista histórico ordenado

### 5.3 Canais Externos
- [x] Teams webhook envia mensagem formatada sem HTML injection
- [x] Email Resend entrega Daily RAG Report
- [x] Email Resend entrega Shift Report
- [ ] Falha de envio é logada em `teams_webhook_logs`
- [ ] Retries com backoff em falha transitória

### 5.4 Triggers
- [x] `requires_wo=true` no stop code dispara push + bell + sirene
- [x] Low stock dispara notificação para admin
- [x] WO crítica nova alerta engineers do turno

---

## 6. INTEGRAÇÕES

### 6.1 iTouching Polling
- [x] Cron `intouch-poll` ativo (a cada 10s, escalonado)
- [x] Autenticação via `x-cron-secret` OR admin JWT
- [x] Cria WO automática SOMENTE em transição real de stop code
- [x] Stop codes com `requires_wo=true`: Maintenance Issue + sub-códigos, Metal Detector Checks
- [x] Janela de 4h previne WOs duplicadas para mesma máquina
- [x] Baseline limpa quando última WO da máquina é fechada
- [x] Não cria SKU automaticamente

### 6.2 iTouching Sync Produção
- [x] Cron 06:30 e 18:30 (London) dispara `intouch-sync-production`
- [x] Cron a cada 5 min sincroniza actuals
- [x] Toggle "Disable current-shift sync" default = ON
- [x] Puxa actual_qty, scrap_qty, run_time, down_time, oee
- [x] Botão "Sync now" força sincronização imediata
- [x] Tabela `intouch_sync_runs` registra status de cada execução

### 6.3 iTouching Machines & SKUs
- [x] `intouch-list-machines` retorna GUIDs corretos
- [x] "Auto-map all machines" mapeia via Jaccard similarity
- [x] `intouch-list-products` com fallback para `production_items`
- [x] Import XLSX usa headers exatos do iTouching, calcula `target_per_hour`
- [x] SKU Sync Diagnostics polling visibility-aware (30s/120s)

### 6.4 iTouching Webhook
- [x] `intouch-webhook` resolve Line Leader ativo como `requested_by`
- [x] Payload validado com Zod
- [x] Logado em `intouch_webhook_logs`

### 6.5 RAG Weekly Sync
- [x] Trigger `trg_sync_rag_actual` soma `production_items.actual_qty` → `rag_weekly_entries.actual_qty`
- [x] Trigger `trg_sync_items_target_from_rag` faz auto-rescale de targets
- [x] Edição inline (admin) atualiza em <1s via realtime
- [x] Downtime no RAG referencia WO # com badge de status
- [x] Aviso ⚠ de arredondamento quando soma SKU ≠ total da linha
- [x] Toggles diários/turno via `rag_week_exclusions` excluem do cálculo

### 6.6 Outras Integrações
- [x] SharePoint import via `sharepoint-download-file` Edge Function
- [x] `calculate-shift-targets` recalcula targets por SKU (660 min/turno)
- [x] Todos os cron jobs estão ativos (verificar `cron.job`)
- [x] Nenhum cron job em loop infinito

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
