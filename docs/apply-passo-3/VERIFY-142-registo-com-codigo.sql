-- Verificação do BLOCO 142 — o registo automático exige o código de convite. Só lê.
--
-- Pode correr-se na produção a qualquer hora. Lê o catálogo (md5 do corpo, o mesmo que
-- src/__tests__/thePaste142IsBlock142.test.ts guarda) e a configuração do registo, sem o
-- código em si. Não escreve nada.
--
-- Esperado depois de colar: a primeira linha 'ok'. As outras são informação.

select '142 handle_new_user é a da migração' as check,
       coalesce((select case when md5(p.prosrc) = '6bff757c81c256a77d034405944be78f' then 'ok'
                             else 'diferente (md5 ' || md5(p.prosrc) || ')' end
                   from pg_proc p where p.proname = 'handle_new_user' and p.pronamespace = 'public'::regnamespace),
                'em falta') as result
union all
select '142 papel automático do registo (informação)',
       coalesce((select coalesce(self_signup_role::text, 'nenhum (fila do admin)') from public.signup_config where id), '-')
union all
select '142 registo aberto (informação)',
       coalesce((select case when enabled and (invite_expires_at is null or invite_expires_at > now())
                             then 'aberto' else 'fechado' end from public.signup_config where id), '-');
