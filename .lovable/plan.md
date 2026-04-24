## Plano para corrigir o erro ao reabrir a mesma OS para o mesmo problema

### Diagnóstico
O erro atual vem do fluxo de recorrência do operador.

Hoje o botão de recorrência chama `log_wo_retrigger()`, e essa função grava `auth.uid()` em `work_order_logs.engineer_id`. Só que esse campo tem FK para `public.engineers(id)`, enquanto `auth.uid()` do operador vem de `profiles/auth users`. Resultado: quebra de foreign key quando o operador tenta abrir novamente o mesmo problema.

## O que vou implementar

### 1. Backend: trocar o fluxo de recorrência por criação segura de uma nova OS de recorrência
Vou criar uma RPC server-side para recorrência que:
- recebe a OS original fechada/finalizada
- cria uma nova work order ligada à original via `recurrence_of_wo_id`
- copia os campos operacionais relevantes (`requester_name`, `operator_id`, `machine`, `description`, `priority`, `line_id`, `mobile_asset_id`)
- reseta status e timestamps para uma nova execução normal
- adiciona a observação da recorrência sem escrever `auth.uid()` em `work_order_logs.engineer_id`
- retorna o `id` e `wo_number` da nova OS

Isso substitui o uso de `log_wo_retrigger()` nesse ponto crítico.

### 2. Frontend: ajustar `OperatorRecurrenceCard`
Vou atualizar o card para:
- parar de chamar `log_wo_retrigger()`
- chamar a nova RPC de criação de recorrência
- mudar o texto do modal de “não será criada nova OS” para o comportamento real
- invalidar as queries de work orders
- mostrar toast com o novo número da OS
- opcionalmente navegar direto para a nova OS

### 3. Compatibilidade com o fluxo atual do engenheiro
Como a recorrência passará a ser uma nova OS aberta:
- ela entra no fluxo normal de aceite/início/finalização
- aparece corretamente no dashboard do engenheiro
- mantém rastreabilidade com `recurrence_of_wo_id`
- evita o conflito entre IDs de operador e IDs da tabela `engineers`

### 4. Ajuste de rastreabilidade
Vou preservar o histórico da OS original sem depender de `work_order_logs.engineer_id` com ID inválido. A rastreabilidade principal ficará em:
- `recurrence_of_wo_id` na nova OS
- observação da recorrência
- audit log do disparo da recorrência

## Resultado esperado
Quando o mesmo problema voltar e o operador tocar em recorrência:
- não haverá mais erro de foreign key
- uma nova OS de recorrência será aberta corretamente
- o histórico continuará ligado à OS original
- o engenheiro poderá tratar normalmente a nova ocorrência

## Detalhes técnicos
- Arquivos principais: `src/components/OperatorRecurrenceCard.tsx` e nova migration SQL
- Não vou editar os arquivos auto-gerados da integração
- A correção será feita no banco via migration e no frontend via mutation/RPC
- Se existir contagem de recorrências baseada em `work_order_logs`, vou ajustar para usar o vínculo `recurrence_of_wo_id` ou manter compatibilidade sem depender do log quebrado