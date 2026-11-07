-- APLICAR 152 — uma ordem nova chega ao telemóvel dos engenheiros, e a sirene volta a ouvir.
--
-- PT: Colar no SQL Editor do AN Maintenance (Supabase), o ficheiro inteiro. É o BLOCO 152 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Põe work_orders no realtime (se faltar), aponta as
-- funções que ainda chamam o projeto antigo para o AN Maintenance, e cria o trigger que manda
-- cada ordem nova ao telemóvel dos engenheiros. Não muda nem apaga linhas. Pode colar-se duas
-- vezes. Depois correr VERIFY-152-ordem-nova-toca-o-engenheiro.sql (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 152. Then run
-- VERIFY-152.

-- ================================================================
-- BLOCO 152
-- 20261107090000_new_wo_reaches_engineers_phones.sql
-- ================================================================
-- A new maintenance order reaches the engineers' phones, and the alert's two roads are open.
--
-- WHY. 07/11/2026: engineers were not hearing the siren when an order came in. The siren only
-- sounds in an open app, on the order's realtime INSERT, and nothing at all reached a phone
-- whose app was closed or whose screen was locked: no push was ever sent for a new order.
-- Since 06/11 production is AN Maintenance (apblxaaktftinstoidvp), restored from the old
-- project; the realtime publication and the push trigger's address may have come across from
-- there or not. Decided 07/11 (Q4-Q6).
--
-- WHAT CHANGES.
--   1. `work_orders` is in the `supabase_realtime` publication (added only if missing).
--      Without it no open app hears a new order, and the siren never starts.
--   2. Database functions that still call the old project's server functions
--      (ybtrzqzliepknpzqdajx) are rewritten to call AN Maintenance's. Each is re-created from
--      its own current definition with only the address replaced, so nothing else in it
--      changes. In the repository that is `notification_push`, which carries every bell row
--      to the phone.
--   3. `wo_new_alert_engineers`: when an order is created open (warehouse orders excepted, as
--      in the app's siren), every engineer it may go to gets a bell row of kind `wo_new`, and
--      `notification_push` sends it to their phone. An order already assigned or locked to one
--      engineer goes to that engineer only. The app's per-device line filter lives in the
--      browser, so the phone hears every line.
--
-- It never refuses the order: any failure is a WARNING and the INSERT goes on. No existing row
-- is changed or deleted.

-- ── 1. Realtime ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_orders'
  ) then
    alter publication supabase_realtime add table public.work_orders;
    raise notice '152: work_orders added to supabase_realtime';
  end if;
end $$;

-- ── 2. Server-function calls go to AN Maintenance ───────────────────────────
do $$
declare
  f record;
begin
  for f in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc like '%ybtrzqzliepknpzqdajx.supabase.co/functions/v1/%'
  loop
    execute replace(pg_get_functiondef(f.oid),
                    'https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/',
                    'https://apblxaaktftinstoidvp.supabase.co/functions/v1/');
    raise notice '152: % now calls AN Maintenance', f.oid::regprocedure;
  end loop;
end $$;

-- ── 3. A new order rings the engineers' phones ──────────────────────────────
create or replace function public.wo_new_alert_engineers()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    insert into public.notifications (user_id, kind, title, body, priority, wo_id, action_url)
    select distinct ur.user_id,
           'wo_new',
           left('🚨 New maintenance order' || coalesce(' WO-' || new.wo_number, ''), 200),
           left(concat_ws(' — ', nullif(btrim(new.machine), ''), nullif(btrim(new.requester_name), ''))
                || coalesce(E'\n' || nullif(btrim(new.description), ''), ''), 2000),
           'critical',
           new.id,
           '/dashboard/engineer'
    from public.user_roles ur
    where ur.role = 'engineer'
      and (new.engineer_id is null or new.engineer_id = ur.user_id)
      and (new.locked_engineer_id is null or new.locked_engineer_id = ur.user_id);
  exception when others then
    raise warning 'wo_new_alert_engineers(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.wo_new_alert_engineers() from public, anon, authenticated;

drop trigger if exists wo_new_alert_engineers on public.work_orders;
create trigger wo_new_alert_engineers
  after insert on public.work_orders
  for each row
  when (new.status = 'open' and coalesce(new.wo_type, 'production') <> 'warehouse_service')
  execute function public.wo_new_alert_engineers();

notify pgrst, 'reload schema';
