-- APLICAR 162 — o poll do iTouch corre um de cada vez, e o pg_net espera 30 s pela resposta.
--
-- PT: Colar no SQL Editor do projeto AN Maintenance (Supabase), o ficheiro inteiro. É o
-- BLOCO 162 do APPLY-ALL-IN-ORDER.sql, byte a byte. Cria a tabela intouch_poll_lease (uma
-- linha) e as funções intouch_poll_try_start / intouch_poll_finish, só para service_role,
-- e muda o job intouch-poll-60s para esperar 30 s (timeout_milliseconds) em vez de 5 s.
-- O segredo continua a ser lido do vault a cada execução; nenhum segredo está aqui.
-- Não muda dados existentes. Pode colar-se duas vezes. Depois correr VERIFY-162 (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 162. Adds the
-- poll lease and gives the cron request a 30 s timeout. Then run VERIFY-162.

-- ================================================================
-- BLOCO 162
-- 20261111220000_intouch_poll_one_at_a_time.sql
-- ================================================================
-- The iTouch poll runs one at a time, and pg_net waits long enough to hear it finish.
--
-- WHAT HAPPENED. pg_cron job `intouch-poll-60s` calls the intouch-poll function every
-- minute with net.http_post and no timeout_milliseconds, so pg_net gives up after its
-- default 5 seconds. On 11/11/2026 the function's p95 was 7.1 s (slowest 33 s), and in
-- six hours net._http_response held 84 timed-out requests out of 424. The function keeps
-- running after pg_net gives up, nothing stopped the next minute's run from starting on
-- top of a slow one, and the cron history says "succeeded" for all of them because the
-- SQL only queues the request.
--
-- WHAT THIS DOES.
--   1. `intouch_poll_lease`: one row saying since when a poll has been running.
--   2. `intouch_poll_try_start(p_lease_seconds)`: takes the lease if it is free or older
--      than p_lease_seconds, in one statement, and says whether it did. The edge
--      function asks it before doing anything and skips the run if the answer is false.
--   3. `intouch_poll_finish()`: clears the lease. The function calls it when it ends.
--      A run that dies without calling it is forgotten when the lease expires (the
--      function asks for 180 s, longer than an edge function can live).
--   4. The cron job's request waits 30 s instead of 5 s. The URL is taken from the job
--      as it is now, and the secret is still read from the vault at every run, as it
--      is today. No secret is written here.
--
-- An advisory lock was the other option, and it does not work through PostgREST: each
-- request gets a pooled connection, so a session lock can stay held on a connection the
-- next request never uses.
--
-- Only service_role (the edge function) may call the two functions or touch the table.
-- Idempotent: it can be pasted twice. Where pg_cron is not installed (a preview branch)
-- step 4 is skipped with a notice.

create table if not exists public.intouch_poll_lease (
  id            text primary key default 'singleton' check (id = 'singleton'),
  running_since timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.intouch_poll_lease enable row level security;
revoke all on table public.intouch_poll_lease from public, anon, authenticated;
grant select, insert, update on table public.intouch_poll_lease to service_role;

insert into public.intouch_poll_lease (id) values ('singleton') on conflict (id) do nothing;

-- True when this caller now holds the lease. One statement, so two runs arriving
-- together cannot both get true: the second waits for the first's row lock and then
-- sees a running_since that is no longer free.
create or replace function public.intouch_poll_try_start(p_lease_seconds integer default 180)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken boolean;
begin
  insert into public.intouch_poll_lease as l (id, running_since, updated_at)
  values ('singleton', now(), now())
  on conflict (id) do update
     set running_since = now(), updated_at = now()
   where l.running_since is null
      or l.running_since < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 180), 1))
  returning true into v_taken;
  return coalesce(v_taken, false);
end;
$$;

create or replace function public.intouch_poll_finish()
returns void
language sql
security definer
set search_path = public
as $$
  update public.intouch_poll_lease
     set running_since = null, updated_at = now()
   where id = 'singleton' and running_since is not null;
$$;

revoke all on function public.intouch_poll_try_start(integer) from public, anon, authenticated;
revoke all on function public.intouch_poll_finish() from public, anon, authenticated;
grant execute on function public.intouch_poll_try_start(integer) to service_role;
grant execute on function public.intouch_poll_finish() to service_role;

-- The cron job: same schedule, same URL, same body, the secret still read from the vault
-- when it runs; only the timeout is new.
do $$
declare
  v_job bigint;
  v_cmd text;
  v_url text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed here: cron job left alone';
    return;
  end if;

  select jobid, command into v_job, v_cmd from cron.job where jobname = 'intouch-poll-60s';
  if v_job is null then
    raise notice 'cron job intouch-poll-60s not found: nothing to change';
    return;
  end if;

  v_url := substring(v_cmd from $re$url\s*:=\s*'([^']+/functions/v1/intouch-poll)'$re$);
  if v_url is null then
    raise notice 'cron job intouch-poll-60s has an unexpected command: left alone';
    return;
  end if;

  perform cron.alter_job(
    job_id  := v_job,
    command := format($cmd$
  SELECT net.http_post(
    url:=%L,
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body:=jsonb_build_object('source','cron-60s','at', now()),
    timeout_milliseconds:=30000
  );
$cmd$, v_url)
  );
end;
$$;

notify pgrst, 'reload schema';
