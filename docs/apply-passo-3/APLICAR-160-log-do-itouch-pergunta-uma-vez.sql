-- APLICAR 160 — o log do iTouch pergunta o papel uma vez por consulta, não por linha.
--
-- PT: Colar no SQL Editor do projeto AN Maintenance (Supabase), o ficheiro inteiro. É o
-- BLOCO 160 do APPLY-ALL-IN-ORDER.sql, byte a byte. Só recria a política de leitura de
-- intouch_status_log com os mesmos cinco papéis: quem pode ler não muda. Pode colar-se
-- duas vezes. Depois correr VERIFY-160 (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 160. It only
-- recreates the read policy on intouch_status_log, same roles. Then run VERIFY-160.

-- ================================================================
-- BLOCO 160
-- 20261110210000_status_log_policy_asks_the_role_once.sql
-- ================================================================
-- The iTouch status log asks who you are once per query, not once per row.
--
-- WHAT HAPPENED. smart_target_shift_runs() (RAG Weekly and Smart Target) timed out four times
-- on 10/11/2026 (57014). It is SECURITY INVOKER, so it reads intouch_status_log through RLS.
-- A week is about 7,400 rows of that table, and the policy called has_role() for each of them:
-- up to five calls a row, each a lookup in user_roles. On AN Maintenance (Micro compute) that
-- turned a 0.25-second query into one that crossed the 8-second limit whenever the instance
-- was busy.
--
-- THE FIX. The same five roles, each wrapped in its own scalar subquery, so Postgres runs each
-- check once per query (an InitPlan) and reuses the answer for every row. Who can read the log
-- does not change. The policy existed only in the database until now; this puts it in a
-- migration.

drop policy if exists "staff read intouch status log" on public.intouch_status_log;

create policy "staff read intouch status log"
  on public.intouch_status_log
  as permissive
  for select
  to authenticated
  using (
    (select public.has_role((select auth.uid()), 'admin'::public.app_role))
    or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
    or (select public.has_role((select auth.uid()), 'production_office_admin'::public.app_role))
    or (select public.has_role((select auth.uid()), 'maintenance_manager'::public.app_role))
    or (select public.has_role((select auth.uid()), 'engineer'::public.app_role))
  );
