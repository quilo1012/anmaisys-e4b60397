# Plano — Seção “Operator Accounts” na DevicesPage

## Objetivo
Permitir que admin/manager criem, listem, editem e resetem senhas de contas de operador por tablet/agrupamento de linhas, eliminando o conflito de sessão causado por logins compartilhados.

## Arquivos a criar

### `src/components/OperatorAccountsSection.tsx` (NOVO)
Componente isolado que encapsula toda a UI da seção. Recebe `isAdmin: boolean` como prop para controlar visibilidade do "Reset All".

**Conteúdo:**
- **Card** principal com header (título + botões "Create Account" e "Reset All Passwords" — este último admin-only).
- **Tabela** de contas: `Label | Email | Lines covered (badges) | Created | Actions`.
  - Actions por linha: Copy Email (clipboard), Reset Password (single), Edit lines.
  - Mapa `line_id → name` via `useLines()` para renderizar badges nomeados.
  - Empty state com ícone e instruções.
- **Dialog "Create Account"**:
  - Campos: Label, Email (auto-slug `operator.<slug>@anmaisys.local` editável), Password (toggle visibility), Lines (checkbox grid).
  - Submit chama `useCreateOperatorAccount.mutateAsync` (async-safe — fecha só após sucesso).
- **Dialog "Edit Account"**:
  - Email read-only, Label editável, Lines via checkbox grid.
  - Submit chama `useUpdateOperatorAccountLines.mutateAsync`.
- **Dialog "Reset Password" (single)**:
  - Nova senha + confirmação + toggle visibility.
  - Submit chama `useResetOperatorPassword.mutateAsync({ password, user_id })`.
- **AlertDialog "Reset ALL Passwords"** (admin only):
  - Nova senha + confirmação + checkbox obrigatório de confirmação.
  - Submit chama `useResetOperatorPassword.mutateAsync({ password })` (sem user_id → reseta todas).
  - Toast com `{ updated, total }` da resposta.
- Sub-componente interno `LineCheckboxGrid` para reutilização entre Create/Edit dialogs.
- Helper `slugifyLabel()` + `buildEmailFromLabel()` para auto-geração de email.

## Arquivos a editar

### `src/pages/dashboard/DevicesPage.tsx`
Mudanças mínimas e cirúrgicas:
1. **Import** do novo componente: `import { OperatorAccountsSection } from "@/components/OperatorAccountsSection";`
2. **Renderização**: adicionar `<OperatorAccountsSection isAdmin={role === "admin"} />` logo depois do Card "All Devices" (após linha 423).
3. Passar a flag `isAdmin` baseada no `role` já disponível via `useAuth()` no componente externo `DevicesPage` — isso requer passar `role` para `DevicesPageContent` ou usar `useAuth()` dentro de `DevicesPageContent` (preferir o segundo, menos invasivo).

## Backend (já pronto, sem mudanças)
- ✅ Tabela `operator_line_accounts` (existe)
- ✅ Edge function `create-operator-account` (deployada)
- ✅ Edge function `reset-operator-password` (deployada)
- ✅ Hook `useOperatorAccounts.ts` com todos os 4 hooks necessários
- ✅ RLS: SELECT autenticado; INSERT/UPDATE/DELETE para admin+manager

## UX & qualidade
- Todos os dialogs **async-safe** (await mutation antes de fechar) — segue `mem://tech/dialogos-async-safe`.
- Inputs com `type="password"` + botão olho para toggle.
- Auto-slug do email reativo ao label (mas trava se o usuário editar manualmente o email).
- Badges coloridos: `secondary` se 1 linha, `default` se múltiplas linhas (visualmente identifica tablets multi-line).
- Loading states em todos os botões de mutation.
- Toasts informativos em sucesso e erro.
- Empty state amigável com ícone `Users` e instruções.

## Fora do escopo
- Não alterar lógica de pareamento `device_token` ↔ `device_lines` (continua igual, ortogonal).
- Não criar UI para deletar conta de operador (RLS permite, mas é destrutivo — fica para próximo round se solicitado).
- Não modificar tela de Login (já feita em rounds anteriores).
- Não modificar `OperatorLineGuard` (já feito).

## Resultado esperado
Admin/manager abre `Devices` → vê nova seção "Operator Accounts" abaixo de "All Devices" → cria 1 conta por tablet → distribui email + senha única → cada tablet loga com sua conta exclusiva → fim dos `Invalid Refresh Token` por sessões duplicadas.
