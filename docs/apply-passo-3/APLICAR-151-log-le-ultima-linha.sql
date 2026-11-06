-- APLICAR 151 — o log de estado do iTouch lê só a última linha de cada máquina.
--
-- PT: Colar no SQL Editor do AN Maintenance (Supabase), o ficheiro inteiro. É o BLOCO 151 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Só muda a função log_intouch_status; grava as mesmas
-- linhas, com muito menos leitura. Pode colar-se duas vezes. Depois correr
-- VERIFY-151-log-le-ultima-linha.sql (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 151. Only
-- log_intouch_status changes, and it writes the same rows. Then run VERIFY-151.

-- ================================================================
-- BLOCO 151
-- 20261106220000_status_log_reads_last_row.sql
-- ================================================================
-- iTouch status log: read each machine's last row, not the whole log.
--
-- WHY. log_intouch_status() runs on a cron and writes a row when a machine's state changes. To
-- learn the last state it walked every row of the log with DISTINCT ON. Measured on production
-- on 06/11 at 100,635 rows: 1,296 ms and 9,077 buffers a run, growing with the log. Decided 06/11,
-- Q70.
--
-- WHAT CHANGES. The way this function finds the last state: one read per machine through the
-- index intouch_status_log_machine_time. Measured the same day: 9 ms and 52 buffers. It writes
-- the same rows as before. No table, index, grant or cron schedule changes.
--
-- This function was only in the database until now. The body is the one live on 06/11, with
-- only the read of the last state replaced.

create or replace function public.log_intouch_status()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer;
begin
  with now_state as (
    select m.intouch_machine_name as machine,
           l.name                 as line,
           m.last_status          as status,
           nullif(m.last_downtime_code, '') as stop_code,
           c.label                as stop_label,
           m.last_seen_at         as reading_at
    from public.intouch_machine_map m
    left join public.lines l on l.id = m.line_id
    left join public.intouch_stop_code_map c
           on lower(c.stop_code) = lower(nullif(m.last_downtime_code, ''))
    where m.line_id is not null
  )
  insert into public.intouch_status_log (machine, line, status, stop_code, stop_label, reading_at)
  select n.machine, n.line, n.status, n.stop_code, n.stop_label, n.reading_at
  from now_state n
  left join lateral (
    select s.machine, s.status, s.stop_code
    from public.intouch_status_log s
    where s.machine = n.machine
    order by s.changed_at desc
    limit 1
  ) p on true
  where p.machine is null
     or p.status    is distinct from n.status
     or p.stop_code is distinct from n.stop_code;

  get diagnostics inserted = row_count;
  return inserted;
end;
$function$;

revoke all on function public.log_intouch_status() from public, anon, authenticated;
