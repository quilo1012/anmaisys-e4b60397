
Objetivo: remover de vez a obrigatoriedade implícita de foto no fluxo do engineer, deixando foto apenas como lembrete opcional.

O que encontrei:
- Não existe bloqueio no backend para foto: o `useFinishWorkOrder()` só atualiza o status para `finished`.
- O bloqueio restante está no fluxo de UI do `EngineerDashboard.tsx`, onde START/FINISH passam por um dialog intermediário de foto.
- Hoje o fluxo depende do estado/callback do dialog para continuar; vou simplificar isso para evitar qualquer travamento ao pular a foto.

Plano de implementação:
1. Reestruturar o fluxo de foto no `EngineerDashboard.tsx`
   - Criar uma continuação explícita do fluxo:
     - START: continuar para `startWO.mutate(...)`
     - FINISH: continuar para checklist pós-serviço e depois assinatura
   - O botão “Skip for now” sempre continuará o fluxo imediatamente.
   - Fechar o dialog não pode mais impedir avanço da ordem.

2. Transformar foto em lembrete, não em requisito
   - Manter o prompt de foto antes do START e antes do FINISH.
   - Trocar o comportamento para:
     - “Take / Upload Photo”
     - “Continue without photo”
   - Mostrar toast de lembrete ao continuar sem foto:
     - Before: lembrar de adicionar foto depois
     - After: lembrar de adicionar foto depois

3. Garantir que FINISH funcione sem upload
   - O engineer poderá:
     - clicar FINISH
     - ignorar a foto
     - completar checklist
     - assinar
     - finalizar a WO normalmente
   - Os botões manuais “Before” e “After” continuam disponíveis durante `in_progress`.

4. Revisar o comportamento mobile e desktop
   - Validar o fluxo no card mobile e na tabela desktop.
   - Garantir que o prompt não reabra nem cancele o avanço por efeito colateral do `onOpenChange`.

Detalhes técnicos:
- Arquivo principal: `src/pages/dashboard/EngineerDashboard.tsx`
- Sem mudança de banco.
- Sem mudança em permissões.
- O ajuste será somente no controle de estado do dialog e no encadeamento do fluxo START/FINISH.

Resultado esperado:
- A ordem pode ser finalizada mesmo sem foto.
- Foto vira apenas recomendação com alerta/toast.
- O engineer não fica mais travado no FINISH por causa da imagem.
