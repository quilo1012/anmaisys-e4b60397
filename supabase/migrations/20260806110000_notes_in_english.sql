-- Notas escritas em português numa aplicação que é toda em inglês.
--
-- The notes added when the two safety orders were reopened, when Danilo Miranda's
-- early finish was moved out of `left_early_at`, and on the twenty-one allocations
-- the rota rule decided, were written in Portuguese. Everything an operator or an
-- engineer reads on screen is in English, and a note in another language in the
-- middle of an order is one more thing to stop and work out.
--
-- The Portuguese stays in the comments — those are read by whoever maintains this,
-- not by the floor.
UPDATE public.work_orders SET notes = replace(notes,
  'Reaberta 06/08: rejeitada a 04/08 17:16 com o motivo "..." — sem justificação registada. Relato de segurança (choque elétrico), prioridade corrigida de low para high.',
  'Reopened 06/08: rejected on 04/08 17:16 with the reason "..." — no justification recorded. Safety report (electric shock); priority corrected from low to high.')
WHERE notes LIKE '%Reaberta 06/08%';

UPDATE public.work_orders SET notes = replace(notes,
  'Reaberta 06/08: rejeitada a 04/08 17:17 com o motivo "Ooo" — sem justificação registada. Metal detetado na Line 1 é evento de contaminação.',
  'Reopened 06/08: rejected on 04/08 17:17 with the reason "Ooo" — no justification recorded. Metal detected on Line 1 is a contamination event.')
WHERE notes LIKE '%Reaberta 06/08%';

UPDATE public.daily_allocations SET note = replace(note, 'Folha diz:', 'Sheet says:')
WHERE note LIKE '%Folha diz%';

UPDATE public.daily_allocations
SET note = 'First name only on the sheet — assigned by the rota that covers this day'
WHERE note LIKE 'Nome só%';
