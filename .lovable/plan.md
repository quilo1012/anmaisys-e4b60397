

# Problem Descriptions Padronizadas

## Resumo

Criar um sistema de descricoes de problema padronizadas que o Manager gerencia e o Operador seleciona ao criar uma WO. Isso substitui o campo livre "Problem Description" por um dropdown com opcoes predefinidas, seguindo o mesmo padrao ja usado para Machines.

---

## 1. Banco de Dados

### Nova tabela: `problem_descriptions`

```text
CREATE TABLE public.problem_descriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.problem_descriptions ENABLE ROW LEVEL SECURITY;

-- Admins CRUD
CREATE POLICY "Admins can manage problem_descriptions"
  ON public.problem_descriptions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Operators e Engineers podem visualizar
CREATE POLICY "Authenticated can view problem_descriptions"
  ON public.problem_descriptions FOR SELECT
  USING (
    has_role(auth.uid(), 'operator'::app_role) OR
    has_role(auth.uid(), 'engineer'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  );
```

### Abordagem para o campo `description` na tabela `work_orders`

O campo `description` (text) continuara armazenando o texto da descricao selecionada. Nao sera criado um FK para `problem_descriptions` — isso garante flexibilidade e evita problemas se uma descricao for deletada futuramente. O valor selecionado do dropdown e salvo diretamente como texto no campo `description`.

---

## 2. Novo Hook: `src/hooks/useProblemDescriptions.ts`

Seguindo o padrao do `useMachines.ts`:
- `useProblemDescriptions()` — lista todas as descricoes (SELECT)
- `useAddProblemDescription()` — insere nova (INSERT)
- `useDeleteProblemDescription()` — remove (DELETE)

---

## 3. Alteracoes no OperatorDashboard.tsx

- Substituir o `<Textarea>` de "Problem Description" por um `<Select>` dropdown
- Listar as descricoes vindas do hook `useProblemDescriptions()`
- Campo obrigatorio: operador deve selecionar uma opcao
- O valor selecionado e salvo no campo `description` da WO (como texto)

---

## 4. Alteracoes no ManagerDashboard.tsx

### 4a. Gestao de Problem Descriptions
- Adicionar botao "Problems" ao lado do botao "Machines" no header
- Ao clicar, abre um Dialog identico ao de Machines (lista + input para adicionar + botao deletar)
- Manager pode adicionar e remover descricoes

### 4b. Criar/Editar WO
- No dialog "Create WO": substituir `<Textarea>` de description por `<Select>` com as descricoes padronizadas
- No dialog "Edit WO": mesmo — `<Select>` em vez de `<Textarea>`

---

## 5. Arquivos Modificados

| Arquivo | Alteracao |
|---------|-----------|
| **Migration SQL** | Nova tabela `problem_descriptions` com RLS |
| `src/hooks/useProblemDescriptions.ts` | Novo hook (list, add, delete) |
| `src/pages/dashboard/OperatorDashboard.tsx` | Textarea vira Select para Problem Description |
| `src/pages/dashboard/ManagerDashboard.tsx` | Botao "Problems" + dialog gestao + Select nos dialogs de criar/editar WO |

---

## 6. Nota

- O campo `description` na tabela `work_orders` permanece como `text` — nenhuma migration de schema na tabela work_orders
- Nao sera necessario alterar `EngineerDashboard`, `WorkOrderDetail`, `exportCsv`, ou `useWorkOrders` — o campo `description` continua funcionando como antes, apenas a origem do valor muda (de digitacao livre para selecao)

