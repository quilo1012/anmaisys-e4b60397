# Plano: Login Unificado + Remoção da página Devices

## Objetivo
Eliminar o conceito de "device pairing" (token físico) e centralizar a identidade do tablet **no próprio login**. O operador escolhe qual tablet/agrupamento de linhas ele é diretamente na tela de login, e isso já define o que ele vê. A criação/gestão dessas contas-tablet sai de `/dashboard/devices` e vai para uma seção dentro de **Manage Users**.

---

## 1. `src/pages/Login.tsx` — Login unificado com toggle Staff/Tablet

### Toggle no topo do card
- Segmented control com 2 botões: **🧑 Staff Login** / **📱 Tablet Login**
- Só renderiza se `useOperatorAccounts()` retornar pelo menos 1 conta
- Persiste a escolha em `localStorage["an_login_mode"]` (`"staff" | "tablet"`)

### Modo Staff (atual, intacto)
- Inputs Email + Password → `supabase.auth.signInWithPassword`
- Para admin / manager / engineer

### Modo Tablet (novo)
- Substitui o input de Email por um `<Select>` grande populado por `useOperatorAccounts()`
- Cada item mostra:
  - **Label** em destaque (ex: "Tablet 5A+5B")
  - Linhas cobertas em texto secundário pequeno (ex: "Line 5A · Line 5B"), resolvidas via `useLines()`
- Auto-preenche `email` interno com `account.email` ao selecionar
- Salva `account.id` em `localStorage["an_tablet_account_id"]` no login bem-sucedido
- Próxima abertura: pré-seleciona a conta salva
- Mantém input de Password (senha global compartilhada)

### Defaults aplicados (questions puladas anteriormente)
- **Modo padrão**: lembrar última escolha (`localStorage`); 1ª vez = Staff
- **Visibilidade do toggle**: só se houver operator accounts criadas
- **Seleção tablet**: dropdown Select + lembrar última escolha
- **Trava de tablet**: livre para trocar (sem PIN extra)

### Estados visuais
- **Loading** do `useOperatorAccounts`: skeleton no Select
- **Vazio** em modo Tablet: mensagem *"Nenhum tablet configurado. Peça ao admin para criar em Manage Users → Tablet Accounts"* + auto-fallback para Staff
- **Badge** discreto no topo do card indicando modo ativo

---

## 2. `src/components/OperatorLineGuard.tsx` — Refatorar para usar a conta logada

### Antes
- Lia `device_token` via `useDeviceLines()` → linhas permitidas vinham de `device_lines`

### Depois
- Lê `auth.user.id` do `useAuth()`
- Busca em `operator_line_accounts` a linha (`line_ids`) da conta logada via `useOperatorAccounts()` (filtra `account.user_id === user.id`)
- Mantém o seletor de linha quando a conta cobre múltiplas linhas
- Mantém o `DeviceLineProvider` com a mesma interface (`allowedLines`, `selectedLineId`, etc.) para não quebrar telas que consomem `useDeviceLineCtx`
- Tela de bloqueio agora diz: *"Esta conta não está vinculada a nenhuma linha. Peça ao admin para configurar em Manage Users → Tablet Accounts"* (sem mostrar token)

---

## 3. `src/pages/users/ManageUsers.tsx` — Receber a seção de Tablet Accounts

- Adicionar uma nova seção **"Tablet Accounts"** abaixo das seções existentes (Users + Engineers)
- Renderizar o componente já existente `<OperatorAccountsSection isAdmin={role==='admin'} />`
- Disponível para admin e manager (mesma regra atual da página)

---

## 4. Remoções (limpeza)

### Arquivos deletados
- `src/pages/dashboard/DevicesPage.tsx`
- `src/hooks/useDevice.ts` (todos os exports: `useDeviceLines`, `useAllDevices`, `usePairDeviceLines`, `useUnpairDevice`, `getDeviceToken`, `clearDeviceToken`, `useDeviceLine`)
- `src/contexts/DeviceLineContext.tsx` (substituído por uma versão simplificada interna no `OperatorLineGuard`, ou mantido com nome novo se mais simples manter o context)
- `src/lib/deviceFetch.ts` (header `x-device-token` deixa de ser necessário)

### Edições
- `src/App.tsx`: remover rota `/dashboard/devices` e o lazy import correspondente
- `src/main.tsx`: remover `installDeviceFetch()` e o import
- `src/components/DashboardLayout.tsx`: remover item "Devices" da sidebar (`navItems`)
- Qualquer outro consumidor de `useDeviceLineCtx` continua funcionando porque o context permanece com a mesma shape (vindo do Guard refatorado)

### NÃO remover (compatibilidade / segurança)
- Tabelas `devices` e `device_lines` no banco — ficam quietas, sem uso pelo frontend
- Funções RPC `pair_device_lines`, `unpair_device`, `touch_device`, `current_device_*` — não causam dano dormente
- Edge functions `create-operator-account` e `reset-operator-password` — continuam servindo a seção de Tablet Accounts
- Tabela `operator_line_accounts` — vira a única fonte de verdade

---

## 5. Verificação

- `npx tsc --noEmit` para garantir que nenhum import quebrou
- Smoke test mental:
  1. Admin abre `/login` no PC pela 1ª vez → modo Staff → loga normal
  2. Operador abre `/login` no Tablet 5A → toggle "📱 Tablet" → escolhe "Tablet 5A+5B" → digita senha → cai em `/dashboard/operator` com `OperatorLineGuard` resolvendo as linhas pela conta logada
  3. Mesmo tablet na 2ª vez → já abre em modo Tablet com conta pré-selecionada
  4. Engineer pega o tablet → toggle "🧑 Staff" → email + senha pessoal → entra
  5. Admin vai em `/users/manage` → seção "Tablet Accounts" → cria/edita/reseta senha

---

## Resultado prático

| Antes | Depois |
|---|---|
| Tablet precisa ser pareado em `/dashboard/devices` com token físico | Tablet só precisa de uma conta criada em Manage Users |
| `OperatorLineGuard` lê `device_token` do localStorage | `OperatorLineGuard` lê do usuário logado |
| Header `x-device-token` em todas as requisições | Removido — RLS já usa `auth.uid()` |
| Item "Devices" na sidebar | Removido |
| Sessions conflitam quando 2 tablets usam o mesmo login | Cada tablet loga numa conta única → refresh tokens independentes |

---

## Fora de escopo
- Drop das tabelas `devices`/`device_lines` (faço numa migration separada quando você confirmar que tudo funciona)
- Mudanças no fluxo de PIN do engineer
- Mudanças no `AuthContext` ou redirect por role
