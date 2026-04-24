
# Plano de implementação

## 1. Login por linha (resolve conflito de sessões em múltiplos tablets)

### Problema
Hoje todos os tablets logam na mesma conta `operator@...`. Quando um tablet faz login, o Supabase invalida o refresh token dos outros → cai a sessão.

### Solução
Criar **1 conta de operador por agrupamento de tablet** (não por linha individual).
- Tablet 5A+5B → `operator.line5@anmaisys.local`
- Tablet 6A+6B → `operator.line6@anmaisys.local`
- Tablet 7 → `operator.line7@anmaisys.local`

Cada tablet físico = 1 conta exclusiva → zero conflito.

### Backend
**Migration nova:**
- Tabela `operator_line_accounts` (id, user_id, email, label, line_ids[], created_at, created_by)
- RLS: admin/manager gerenciam; authenticated lê (label + email — não é sensível)
- RPC `reset_all_operator_passwords(_new_password)` — admin only, reseta senha de TODAS as contas operator de uma vez

**Edge functions novas:**
- `create-operator-account` (admin/manager): cria user no Supabase Auth + role operator + registro na tabela. Body: `{ email, password, label, line_ids[] }`
- `reset-operator-password` (admin): muda senha de uma ou todas as contas operator

### Frontend
**`src/pages/dashboard/DevicesPage.tsx`** — nova seção "Operator Accounts":
- Lista todas as contas operator (label, email, lines, criada em)
- Botão "Create Account" → modal com label, email sugerido auto, multi-select de linhas, senha única (lê de admin settings)
- Botão "Show Credentials" por conta — mostra email + senha para o admin escrever no tablet
- Botão "Reset All Passwords" — admin define nova senha única

**`src/pages/Login.tsx`** — dropdown no topo:
- "Select your line/tablet" lista as contas operator
- Ao escolher, preenche email automaticamente; operador só digita a senha
- Mantém login manual para admin/manager/engineer

**`src/hooks/useOperatorAccounts.ts`** — hook novo (list, create, resetPassword)

---

## 2. Simplificação do workflow do Engineer (menos PINs)

### Problema
Hoje o engineer digita PIN no Accept e de novo no Finish.

### Solução
- **Accept**: mantém PIN (única identidade/auditoria)
- **Finish**: remove PIN. Só pede "Resolution notes" e finaliza
- **`src/pages/dashboard/EngineerDashboard.tsx`**: `handleFinishConfirm` chama `finishWO.mutateAsync()` direto (sem `accept_wo_with_pin`/`finish_wo_with_pin`)
- **Remover** o campo "Operator/Line Leader Signature" do Finish dialog

---

## 3. Operator não precisa assinar para fechar WO

### Solução
- **`src/pages/dashboard/OperatorDashboard.tsx`**: remover o `closeDialogWO` (assinatura)
- Botão "Close" chama `closeWO.mutateAsync` direto, passando `profile?.name` automaticamente como signature (mantém rastreabilidade no DB sem fricção)

---

## 4. Sidebar sempre oculta — só abre quando clicar

### Solução
**`src/components/DashboardLayout.tsx`**:
- Trocar `collapsible="icon"` → `collapsible="offcanvas"` no `<Sidebar>`
- Adicionar `defaultOpen={false}` no `<SidebarProvider>`
- O `SidebarTrigger` (☰) no header já existe e continua sempre visível
- Resultado: sidebar 100% oculta por padrão; clicar no menu (☰) abre sobrepondo o conteúdo; clicar fora fecha

---

## 5. Esconder "Change Password" para operator

### Solução
**`src/components/DashboardLayout.tsx`**: envolver botão "Change Password" em `{(role === "admin" || role === "manager" || role === "engineer") && (...)}`. Operator (login compartilhado de tablet) e viewer não veem.

---

## 6. Manter sessão ativa — não deslogar sozinho

### Solução
**`src/contexts/AuthContext.tsx`**:
- **Keep-alive proativo**: `setInterval` 5min chamando `supabase.auth.getSession()` para forçar refresh do token antes de expirar
- **Wake-up listener**: `document.addEventListener("visibilitychange", ...)` — quando tablet volta do sleep, tenta `getSession()` antes de qualquer redirect
- **Não derrubar sessão em erro transitório**: se `getSession()` falhar por rede, manter o estado atual em vez de limpar `user/profile/role`

`supabase/client.ts` já tem `persistSession: true` + `autoRefreshToken: true` + `storage: localStorage` — mantido.

**`src/components/OperatorLineGuard.tsx`**:
- Substituir "Sign Out" imediato por `AlertDialog` de confirmação — evita logout acidental por toque

---

## Ordem de execução
1. Migration + edge functions de operator accounts
2. UI da DevicesPage (seção Operator Accounts)
3. Login com dropdown de linha
4. Sidebar offcanvas + esconder Change Password
5. Hardening de sessão (AuthContext + AlertDialog no OperatorLineGuard)
6. Simplificação Engineer Finish (sem PIN, sem signature)
7. Simplificação Operator Close (sem dialog de assinatura)

## Fora do escopo
- Pareamento `device_token` ↔ `device_lines` (continua igual; é ortogonal ao login)
- Publish (só após validar no preview)
- Mexer em `client.ts` ou `types.ts` (auto-gerados)

## Migração dos tablets existentes (passo do usuário, não do código)
1. Criar 1 conta por agrupamento de tablet na DevicesPage
2. Em cada tablet: sign out → escolher linha no novo dropdown → digitar senha única
3. Desativar a conta antiga compartilhada depois
