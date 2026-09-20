-- VERIFICAR os blocos 57 e 58 — o PIN de admin
--
-- Correr UMA query de cada vez: o editor do Supabase só mostra o resultado da
-- última. Um ficheiro neste repositório é o recibo do que se pretendeu, nunca a
-- prova do que a base tem.

-- ── 1. O hash saiu das vistas ────────────────────────────────────────────────
-- TEM DE DEVOLVER ZERO LINHAS. Qualquer linha aqui é a porta outra vez aberta —
-- e basta um GRANT de tabela em system_settings, em qualquer migração futura,
-- para a reabrir sem que nada se queixe.
select grantee, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name   = 'system_settings'
   and column_name  = 'admin_pin'
   and grantee in ('authenticated', 'anon');

-- ── 2. E as outras colunas continuam legíveis ────────────────────────────────
-- TEM DE DEVOLVER SEIS LINHAS de SELECT: id, created_at, updated_at,
-- intouch_auto_wo_enabled, intouch_sync_enabled, rag_api_base_url. Se faltar uma,
-- o ecrã que a lê responde "permission denied for table system_settings" — uma
-- mensagem que manda quem a lê para as policies da RLS, onde a resposta não está.
select column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name   = 'system_settings'
   and grantee      = 'authenticated'
   and privilege_type = 'SELECT'
 order by column_name;

-- ── 3. A escada existe ───────────────────────────────────────────────────────
-- As três colunas têm de vir preenchidas. `null` em qualquer uma é o bloco 58 por
-- aplicar, e o código que já chama a função com_escada parte.
select to_regclass('public.admin_pin_attempts')                        as tabela,
       to_regprocedure('public.verify_admin_pin_with_lockout(text)')   as com_escada,
       to_regprocedure('public.verify_admin_pin(text)')                as booleana;

-- ── 4. Recriar uma função devolve-lhe o anon ─────────────────────────────────
-- TEM DE DEVOLVER ZERO LINHAS. O REVOKE FROM PUBLIC está nas duas migrações, mas
-- é a primeira coisa que se perde quando alguém recria a função à mão.
select p.proname, a.grantee
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public'
   and p.proname in ('verify_admin_pin', 'verify_admin_pin_with_lockout')
   and r.rolname in ('anon', 'public')
   and a.privilege_type = 'EXECUTE';

-- ── 5. O PIN continua a ser um hash, e não um PIN ────────────────────────────
-- TEM DE DIZER `bcrypt`. Se disser `em claro`, alguém escreveu na coluna por fora
-- de set_admin_pin() e a partir daí crypt(_pin, admin_pin) não compara nada.
select case when admin_pin like '$2%' then 'bcrypt' else 'EM CLARO' end as estado,
       length(admin_pin) as comprimento
  from public.system_settings;

-- ── 6. E no ecrã ─────────────────────────────────────────────────────────────
-- Seis PINs errados seguidos no Attendance têm de acabar em "Too many attempts",
-- e não em "That PIN is not right" pela sexta vez. Esta linha mostra a contagem:
select user_id, failures, lockout_step, locked_until, last_attempt
  from public.admin_pin_attempts
 order by last_attempt desc;
