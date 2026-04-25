## Problema

Hoje a página `/users/manage` tem dois cards que parecem mostrar a mesma coisa:

- **Login Accounts** → mostra `Name + Email + Role` (admins, managers, engenheiros)
- **Operator Accounts** → mostra `Label + Email + Lines` (tablets)

O **Email** aparece nos dois lugares, com formatos diferentes (real vs. `operator.tablet-5a@anmaisys.local`), o que confunde sobre "qual é o email de quem".

## Mudanças propostas

### 1. Renomear os títulos para deixar o propósito claro

**`src/pages/users/ManageUsers.tsx`** (linhas ~343-344 e ~394)
- `User Management` → **`Staff Members`**
- subtítulo `Create and manage login accounts` → **`Admins, managers and engineers — people who log in with their personal email`**
- Card title `Login Accounts` → **`Staff Members`**

**`src/components/OperatorAccountsSection.tsx`** (linhas ~377-382)
- Card title `Operator Accounts` → **`Tablet Stations`**
- Description → **`One station per tablet (or tablet group). Each station covers one or more production lines and shares the same login across shifts.`**

### 2. Esconder a coluna Email em Tablet Stations

Em `OperatorAccountsSection.tsx` (linhas ~417-446):
- Remover a coluna **`Email`** do `<TableHeader>` e do `<TableBody>` da tabela.
- Manter o botão **`Copy email`** em Actions (já existe) para quando admin/manager precisar do email para suporte.
- Adicionar tooltip no botão Copy: `"Copy login email (used by the tablet)"`.

Resultado: a tabela passa a mostrar **`Label | Lines covered | Created | Actions`** — focada na função operacional (qual tablet cobre quais linhas), sem expor o email técnico que ninguém digita.

### 3. Pequena dica visual no card Tablet Stations

Logo abaixo do `<CardDescription>`, adicionar um aviso discreto:
> *"Operators don't type an email — they pick their tablet from a dropdown on the login screen."*

Isso reforça que o "email" do tablet é interno e não precisa estar visível na lista.

### 4. (Sem mudanças no backend / RLS / migrations)

A coluna `email` continua existindo na tabela `operator_line_accounts` (necessária para o Supabase Auth) e continua sendo retornada pelo hook `useOperatorAccounts` — só não é mais renderizada como coluna na tabela. Login do tablet continua funcionando normalmente.

## Arquivos editados

- `src/pages/users/ManageUsers.tsx` — renomear título, subtítulo e título do card
- `src/components/OperatorAccountsSection.tsx` — renomear card, esconder coluna Email, adicionar dica

Nenhuma migration, nenhum edge function, nenhuma quebra de login.