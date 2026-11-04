-- Verificação do BLOCO 144 — a presença já não reconstrói a lista de contactos. Só lê.
--
-- Lê o catálogo, nenhuma linha. Esperado depois de colar: 'ok'.

select '144 communication_can_view_presence pergunta chat_may_start por pessoa' as check,
       case when pg_get_functiondef('public.communication_can_view_presence(uuid)'::regprocedure)
                 ilike '%chat_contactable_people%' then 'ainda lê a lista inteira'
            when pg_get_functiondef('public.communication_can_view_presence(uuid)'::regprocedure)
                 ilike '%chat_may_start%' then 'ok'
            else 'definição inesperada' end as result;
