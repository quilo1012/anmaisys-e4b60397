## Objetivo
Criar uma conta de tablet **"Production Tablet"** vinculada ao email `productionappliednutrition@gmail.com` com acesso a **todas as linhas de produção** (e portanto, a todas as máquinas via line_id).

## Detalhes da Conta
| Campo | Valor |
|---|---|
| **Label** | Production Tablet |
| **Email** | productionappliednutrition@gmail.com |
| **Password** | Tablet@AN2026! (mesma padrão das outras tablets) |
| **Linhas** | TODAS as linhas existentes em `public.lines` |
| **Role** | operator |

## Implementação (1 passo)

### Edge Function `create-operator-account`
Invocar a função existente passando:
- `email`: `productionappliednutrition@gmail.com`
- `password`: `Tablet@AN2026!`
- `label`: `Production Tablet`
- `line_ids`: array com **todos os UUIDs** retornados de `SELECT id FROM public.lines`

A função já cuida de:
1. Criar o usuário em `auth.users` com email confirmado
2. Atualizar `profiles.name` com o label
3. Atribuir role `operator` em `user_roles`
4. Criar registro em `operator_line_accounts` com todas as `line_ids`

### Verificação
- Confirmar que a conta aparece na aba **Tablet Stations** (`/users/manage`)
- Confirmar login funciona via modo Tablet em `/login`
- Confirmar que ao logar, o seletor de linha mostra TODAS as linhas (porque `allowedLines.length > 1`)

## Notas
- **Acesso a máquinas**: As máquinas são automaticamente acessíveis porque estão vinculadas às linhas via `line_id`/`current_line`/`fixed_line`. Não há tabela de permissão por máquina — o acesso é derivado da linha selecionada no `DeviceLineContext`.
- **Sem alteração de schema**: Apenas inserção de dados via Edge Function existente. Nenhuma migração necessária.
- **Sem alteração de código**: Toda a infraestrutura (login tablet, seletor de linha, OperatorLineGuard) já suporta contas multi-linha.