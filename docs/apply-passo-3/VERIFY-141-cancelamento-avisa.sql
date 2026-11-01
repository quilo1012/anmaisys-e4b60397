-- Verificação do BLOCO 141 — um cancelamento avisa quem foi avisado do "sim". Só lê.
--
-- Pode correr-se na produção a qualquer hora. Lê o catálogo (md5 do corpo, o mesmo que
-- src/__tests__/thePaste141IsBlock141.test.ts calcula a partir da migração) e conta os
-- avisos de cancelamento escritos desde que o bloco foi colado. Não escreve nada.
--
-- Esperado depois de colar: as três primeiras linhas 'ok'. A quarta só sobe depois de
-- alguém cancelar uma marcação.

select '141 overtime_outcome_cancelled_notify existe e é a da migração' as check,
       coalesce((select case when md5(p.prosrc) = '3fa2c46ae662e1be885dce9018f3c395' then 'ok'
                             else 'diferente (md5 ' || md5(p.prosrc) || ')' end
                   from pg_proc p where p.proname = 'overtime_outcome_cancelled_notify' and p.pronamespace = 'public'::regnamespace),
                'em falta: colar APLICAR-141') as result
union all
select '141 o trigger está em overtime_outcomes e ligado',
       coalesce((select case when t.tgenabled <> 'D' then 'ok' else 'desligado' end
                   from pg_trigger t
                  where t.tgname = 'overtime_outcome_cancelled_notify_t'
                    and t.tgrelid = 'public.overtime_outcomes'::regclass),
                'em falta: colar APLICAR-141')
union all
select '141 ninguém com sessão a pode chamar directamente',
       case when to_regprocedure('public.overtime_outcome_cancelled_notify()') is null then 'em falta'
            when has_function_privilege('authenticated', 'public.overtime_outcome_cancelled_notify()', 'EXECUTE')
              or has_function_privilege('anon', 'public.overtime_outcome_cancelled_notify()', 'EXECUTE') then 'MAU: pode ser chamada'
            else 'ok' end
union all
select '141 avisos de cancelamento escritos (informação)',
       count(*)::text
  from public.notifications
 where kind = 'overtime_booking_cancelled';
