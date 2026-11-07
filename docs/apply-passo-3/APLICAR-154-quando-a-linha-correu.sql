-- APLICAR 154 — quando cada linha correu pela última vez em cada turno (Smart Target).
--
-- PT: Colar no SQL Editor do AN Maintenance (Supabase), o ficheiro inteiro. É o BLOCO 154 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Cria só uma função de leitura; não muda tabelas nem
-- dados. Pode colar-se duas vezes. Depois correr VERIFY-154-quando-a-linha-correu.sql (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 154. One read-only
-- function, no table or data change. Then run VERIFY-154.

-- ================================================================
-- BLOCO 154
-- 20261107210000_smart_target_shift_runs.sql
-- ================================================================
-- Smart Target: when each line last ran in each shift, from the iTouch status log.
--
-- WHY. A line can stop for good before the shift ends: on 07/11 Line 2's last run was at
-- 12:40, and its 12-hour Smart Target of 2,715 was compared with what 6 hours made. The RAG
-- board and the Smart Target page compare with the target for the hours the line was open,
-- and keep shifts that ended before half way out of the engine's measurement. Decided 07/11,
-- Q78 and Q79.
--
-- WHAT. One read-only function, nothing else. Per day and shift in the range, and per line
-- 1 to 6: the end of the last running stretch (status 4 or 8) inside the shift, and the last
-- time the log heard from any machine in that shift, so the page can tell a line that stopped
-- from a log that stopped. SECURITY INVOKER: it reads the log under its own policy (admin,
-- manager, production office, maintenance manager, engineer). At most 62 days a call.
--
-- Until this is pasted the pages compare with the whole shift's target, as before.

create or replace function public.smart_target_shift_runs(p_from date, p_to date)
returns table (
  session_date date,
  shift text,
  line text,
  last_run_at timestamptz,
  heard_until timestamptz
)
language sql stable security invoker set search_path = public
as $$
  with w as (
    select d::date as session_date,
           s.shift,
           (d::date + case s.shift when 'DAY' then time '06:00' else time '18:00' end) at time zone 'Europe/London' as starts,
           ((d::date + case s.shift when 'DAY' then 0 else 1 end) + case s.shift when 'DAY' then time '18:00' else time '06:00' end)
             at time zone 'Europe/London' as ends
    from generate_series(p_from, p_to, interval '1 day') as d
    cross join (values ('DAY'), ('NIGHT')) as s(shift)
    where p_to >= p_from and p_to - p_from <= 62
  ),
  bounds as (
    select min(starts) - interval '12 hours' as lo, max(ends) + interval '12 hours' as hi from w
  ),
  log as (
    select l.line, l.status, l.changed_at,
           lead(l.changed_at) over (partition by l.machine order by l.changed_at) as next_at
    from public.intouch_status_log l, bounds b
    where l.changed_at >= b.lo and l.changed_at < b.hi
  ),
  heard as (
    select w.session_date, w.shift, max(g.changed_at) as heard_until
    from w join log g on g.changed_at > w.starts and g.changed_at <= w.ends
    group by w.session_date, w.shift
  ),
  runs as (
    select w.session_date, w.shift, g.line,
           max(least(coalesce(g.next_at, now()), w.ends)) as last_run_at
    from w join log g
      on g.status in (4, 8)
     and g.changed_at < w.ends
     and coalesce(g.next_at, now()) > w.starts
    where g.line ~ '^Line [1-6]$'
    group by w.session_date, w.shift, g.line
  )
  select r.session_date, r.shift, r.line, r.last_run_at, h.heard_until
  from runs r
  left join heard h on h.session_date = r.session_date and h.shift = r.shift
  order by r.session_date, r.shift, r.line
$$;

revoke all on function public.smart_target_shift_runs(date, date) from public, anon;
grant execute on function public.smart_target_shift_runs(date, date) to authenticated, service_role;
