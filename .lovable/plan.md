## Objetivo
1. Eliminar o conflito visual entre **Staff Members** e **Tablet Stations** (atualmente são duas seções separadas que confundem).
2. Criar automaticamente uma conta de tablet para cada linha de produção que ainda não tem.

---

## Parte 1 — Unificar a página de gestão (`/users/manage`)

Em vez de duas seções separadas, a página passa a ter **uma única tabela "Accounts"** com filtro por tipo:

- **Toggle/Tabs no topo**: `[ All ] [ Staff ] [ Tablet Stations ]`
- Coluna **Type** com badge colorido:
  - 🟣 **Staff** (Admin, Manager, Engineer) — login por email pessoal
  - 🔵 **Tablet** (Operator) — login por dropdown de estação
- Botões de ação contextual:
  - "+ Add Staff Member" → abre dialog atual de criação de usuário staff
  - "+ Add Tablet Station" → abre dialog atual de criação de tablet
- Comportamento mantido: edição, reset de senha, exclusão funcionam igual; só muda o agrupamento visual.

Arquivos afetados:
- `src/pages/users/ManageUsers.tsx` — refator para tabs + tabela unificada
- `src/components/OperatorAccountsSection.tsx` — converter de seção autônoma para sub-componente reutilizável (lógica de criação/edição/reset preservada)

Resultado: uma única tela coerente, sem duplicação de UI.

---

## Parte 2 — Criar tablets automaticamente para todas as linhas

Hoje só existem 2 contas (`LINE 1` e `Tablet 5A+5B`). As 7 linhas sem tablet são:

| Linha | Email gerado |
|---|---|
| Line 2 | `operator.line2@anmaisys.local` |
| Line 3 | `operator.line3@anmaisys.local` |
| Line 4 | `operator.line4@anmaisys.local` |
| Line 5 | `operator.line5@anmaisys.local` |
| Line 6 | `operator.line6@anmaisys.local` |
| Capsules & Tablets | `operator.capsules-tablets@anmaisys.local` |
| Gel Line | `operator.gel-line@anmaisys.local` |
| Sealer and Printer INK | *(já está vinculada a LINE 1 e Tablet 5A+5B — pular)* |

**Senha inicial padrão** para todas: `Tablet@AN2026!`
(forte, passa no HIBP check, é a mesma para facilitar a configuração inicial; admin pode trocar individualmente em seguida)

**Como será feito:**
- Reutilizar a Edge Function existente `create-operator-account` (já valida, cria auth user, perfil, role operator e registro em `operator_line_accounts`).
- Disparar uma chamada por linha a partir de um botão **"Auto-create missing tablets"** no topo da nova aba **Tablet Stations**.
- Após criação, exibir tabela com email + senha temporária para você anotar e configurar nos tablets físicos.

---

## Confirme antes de prosseguir
- ✅ Senha padrão `Tablet@AN2026!` para todas, com troca posterior individual?
- ✅ Pular `Sealer and Printer INK` (já coberta por outras contas)?
- ✅ Unificar as duas seções em uma única tabela com tabs?

Se aprovar, executo Parte 1 (refator UI) + Parte 2 (botão de auto-criação) na mesma rodada.