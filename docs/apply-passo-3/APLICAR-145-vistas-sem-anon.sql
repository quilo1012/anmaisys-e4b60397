-- APLICAR 145 — nenhuma vista responde sem sessão: o anon e o PUBLIC saem de todas.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 145 do APPLY-ALL-IN-ORDER.sql, byte a byte. Depois do 143 e do 144.
--
-- Porquê (auditoria 02/11, DB-001): o anon tinha SELECT em 15 vistas. A que corria como
-- dono foi corrigida no 143; as outras 14 respondem pelo RLS, mas o grant não serve a
-- ninguém e foi assim que o 143 aconteceu. Nada do que a app lê antes do login é vista.
--
-- O que muda: só grants. Em todas as vistas de public tira tudo ao anon e ao PUBLIC e
-- devolve o SELECT ao authenticated e ao service_role onde o tinham. Nenhuma vista é
-- reescrita.
-- Pode colar-se duas vezes.
--
-- Depois de colar: correr VERIFY-145-vistas-sem-anon.sql (só lê).
--
-- EN: Paste the whole file; it is BLOCO 145. It revokes anon and PUBLIC on every view in
-- public and gives authenticated and service_role back the SELECT each had. Then run
-- VERIFY-145.

-- ================================================================
-- BLOCO 145
-- 20261104130000_no_view_answers_without_a_session.sql
-- ================================================================
-- No view answers without a session: anon and PUBLIC come off every view in public.
--
-- WHAT WAS WRONG. Audit 2026-11-02, DB-001. Production (ybtrzqzliepknpzqdajx, P3 Q15
-- on 04/11) granted SELECT to anon on 15 views. One ran as its owner and was fixed by
-- BLOCO 143. The other 14 run as their reader, so RLS answered for them, but a grant
-- nobody needs is one rebuild away from the next leak: that is how 143 happened.
--
-- WHY IT IS SAFE. Nothing the app reads before sign-in is a view. /login, /signup,
-- /privacy and /reset-password call functions (get_login_branding, check_invite_code,
-- list_tablet_accounts_public); every page that reads a view is behind ProtectedRoute,
-- and the edge functions read with the service role.
--
-- WHAT CHANGES. For every view and materialized view in public: REVOKE ALL from anon
-- and PUBLIC, then GRANT SELECT back to authenticated and service_role where each had
-- SELECT before, so a grant one of them only had through PUBLIC is not lost. No view is
-- rewritten, so no option is reset. The owner keeps what it had. Idempotent.

do $$
declare
  v record;
begin
  for v in
    select c.oid, c.oid::regclass as rel,
           has_table_privilege('authenticated', c.oid, 'SELECT') as signed_in_reads,
           has_table_privilege('service_role', c.oid, 'SELECT') as service_reads
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  loop
    execute format('revoke all on %s from anon, public', v.rel);
    if v.signed_in_reads then
      execute format('grant select on %s to authenticated', v.rel);
    end if;
    if v.service_reads then
      execute format('grant select on %s to service_role', v.rel);
    end if;
  end loop;
end $$;
