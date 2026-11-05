-- APLICAR 149 — o alvo do Smart Target fica pronto antes de o turno começar.
--
-- PT: Colar no SQL editor da base de PRODUÇÃO, o ficheiro inteiro. Desde a troca é o
-- AN Maintenance (apblxaaktftinstoidvp): Supabase → SQL editor. É o BLOCO 149 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Precisa do 147 e do 148 aplicados NESSA base.
--
-- Porquê (Smart Target, Q32–Q40): o operador tem de ter o alvo quando começa o turno. A
-- função smart-target-ahead faz o alvo de cada linha a partir da fila do iTouch, 30 e 10
-- minutos antes de cada turno, e o tablet mostra-o (atrás do PIN do líder, como o alvo
-- do RAG).
--
-- O que muda:
-- 1. smart_target_forecasts ganha 4 colunas (por hora, origem, hora da leitura da fila,
--    notas). Nada é apagado.
-- 2. As duas funções de gravação passam a aceitar o servidor (service_role). A origem é
--    decidida pela função, nunca pelo cliente.
-- 3. Ação nova smarttarget.line_target e a função smart_target_line_targets(): o tablet
--    lê o alvo do turno; as Linhas 1, 3 e 6 vêm sem números.
-- 4. Um cron, smart-target-ahead, às :30 e :50 das 04, 05, 16 e 17 UTC.
--
-- ANTES de colar: publicar a função smart-target-ahead (com --no-verify-jwt) e voltar a
-- publicar a intouch-list-scheduled-jobs, a partir do main. Sem isso o cron chama uma
-- função que não existe (inofensivo, mas não faz nada).
--
-- Depois de colar: correr VERIFY-149-alvo-antes-do-turno.sql (só lê). Pode colar-se
-- duas vezes.
--
-- EN: Paste the whole file into the PRODUCTION database (AN Maintenance since the
-- switch); it is BLOCO 149. Needs 147 and 148 there. Deploy smart-target-ahead
-- (--no-verify-jwt) and redeploy intouch-list-scheduled-jobs first. Then run VERIFY-149.

-- ================================================================
-- BLOCO 149
-- 20261105190000_smart_target_ahead.sql
-- ================================================================
-- Smart Target: the line's target is made before the shift starts, and the operator sees it.
--
-- WHY. The target has to be there when the operator starts the shift (decided 05/11,
-- Q32–Q40). The page could only make it once someone opened it during the shift, from a
-- plan that only exists once the shift is opened. The edge function smart-target-ahead
-- now makes it from iTouch's queue 30 and 10 minutes before each shift, and saves it
-- through the same first-save-wins functions the page uses.
--
-- WHAT CHANGES.
-- 1. smart_target_forecasts gets four columns: the forecast per hour (the tablet shows
--    it), where the forecast came from ('page' or 'ahead'), when the iTouch queue it used
--    was read, and the notes that go with it (for example the running job's estimate).
-- 2. save_smart_target_forecasts() and save_smart_target_queue() also accept the
--    service role, which is how the edge function calls them. The source is set by the
--    function from who called it, never taken from the client.
-- 3. A new action, smarttarget.line_target: read the shift's target for the lines,
--    nothing else. The operator holds it by default. It goes through
--    smart_target_line_targets(), which leaves the numbers out for the lines still held
--    back (1, 3 and 6), so the shadow forecasts stay off the tablets.
-- 4. pg_cron calls smart-target-ahead at :30 and :50 of 04, 05, 16 and 17 UTC. The
--    function decides which of those runs fall before a shift, for GMT and BST alike.
--
-- Needs the edge function smart-target-ahead deployed with --no-verify-jwt, and
-- intouch-list-scheduled-jobs redeployed (it now accepts the cron secret).

alter table public.smart_target_forecasts
  add column if not exists expected_per_hour numeric,
  add column if not exists source text not null default 'page',
  add column if not exists queue_read_at timestamptz,
  add column if not exists notes jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smart_target_forecasts_source_check') then
    alter table public.smart_target_forecasts
      add constraint smart_target_forecasts_source_check check (source in ('page', 'ahead'));
  end if;
end $$;

create or replace function public.save_smart_target_forecasts(p_date date, p_shift text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_server boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_server and (
       auth.uid() is null
       or not public.has_action(auth.uid(), 'smarttarget.view',
                                array['admin', 'production_office_admin']::app_role[])) then
    raise exception 'Not allowed to save Smart Target forecasts.' using errcode = '42501';
  end if;
  if p_shift not in ('DAY', 'NIGHT') then
    raise exception 'Shift must be DAY or NIGHT.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The forecasts must be a list.' using errcode = '22023';
  end if;

  insert into public.smart_target_forecasts
    (session_date, shift, line, shown, expected_total, expected_per_hour, status, confidence,
     factor, factor_shifts, jobs, engine_version, frozen_by, source, queue_read_at, notes)
  select p_date, p_shift,
         (r->>'line')::integer,
         coalesce((r->>'shown')::boolean, false),
         nullif(r->>'expected_total', '')::integer,
         nullif(r->>'expected_per_hour', '')::numeric,
         coalesce(nullif(r->>'status', ''), 'insufficient_data'),
         coalesce(nullif(r->>'confidence', ''), 'none'),
         nullif(r->>'factor', '')::numeric,
         nullif(r->>'factor_shifts', '')::integer,
         coalesce(r->'jobs', '[]'::jsonb),
         coalesce(nullif(r->>'engine_version', ''), 'unknown'),
         auth.uid(),
         case when v_server then 'ahead' else 'page' end,
         case when v_server then nullif(r->>'queue_read_at', '')::timestamptz end,
         case when jsonb_typeof(r->'notes') = 'array' then r->'notes' else '[]'::jsonb end
    from jsonb_array_elements(p_rows) as r
   where (r->>'line') ~ '^[1-6]$'
  on conflict (session_date, shift, line) do nothing;

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('saved', v_inserted);
end;
$$;

revoke all on function public.save_smart_target_forecasts(date, text, jsonb) from public, anon;
grant execute on function public.save_smart_target_forecasts(date, text, jsonb) to authenticated, service_role;

create or replace function public.save_smart_target_queue(p_date date, p_shift text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and (
       auth.uid() is null
       or not public.has_action(auth.uid(), 'smarttarget.view',
                                array['admin', 'production_office_admin']::app_role[])) then
    raise exception 'Not allowed to save the iTouch queue.' using errcode = '42501';
  end if;
  if p_shift not in ('DAY', 'NIGHT') then
    raise exception 'Shift must be DAY or NIGHT.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The queue must be a list.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('smart_target_queue|' || p_date::text || '|' || p_shift));
  if exists (select 1 from public.smart_target_queue_snapshots
              where session_date = p_date and shift = p_shift) then
    return jsonb_build_object('saved', false, 'reason', 'already saved for this shift');
  end if;

  insert into public.smart_target_queue_snapshots
    (session_date, shift, line, seq, sku, order_qty, done_qty, status, fetched_by)
  select p_date, p_shift,
         btrim(r->>'line'),
         coalesce(nullif(r->>'seq', '')::integer, 0),
         btrim(r->>'sku'),
         nullif(r->>'order_qty', '')::numeric,
         nullif(r->>'done_qty', '')::numeric,
         nullif(btrim(r->>'status'), ''),
         auth.uid()
    from jsonb_array_elements(p_rows) as r
   where coalesce(btrim(r->>'line'), '') <> ''
     and coalesce(btrim(r->>'sku'), '') <> '';

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('saved', true, 'rows', v_inserted);
end;
$$;

revoke all on function public.save_smart_target_queue(date, text, jsonb) from public, anon;
grant execute on function public.save_smart_target_queue(date, text, jsonb) to authenticated, service_role;

-- The tablet's read. Baseline = the MATRIX default for smarttarget.line_target in
-- src/lib/permissions.ts. Held-back lines come back without numbers or jobs.
create or replace function public.smart_target_line_targets(p_date date, p_shift text)
returns table (
  line integer,
  held_back boolean,
  expected_total integer,
  expected_per_hour numeric,
  status text,
  jobs jsonb,
  notes jsonb,
  source text,
  frozen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'smarttarget.line_target',
                              array['admin', 'manager', 'maintenance_manager', 'operator', 'production_office_admin']::app_role[]) then
    raise exception 'Not allowed to read the line targets.' using errcode = '42501';
  end if;
  return query
    select f.line,
           not f.shown,
           case when f.shown then f.expected_total end,
           case when f.shown then f.expected_per_hour end,
           f.status,
           case when f.shown then f.jobs else '[]'::jsonb end,
           case when f.shown then f.notes else '[]'::jsonb end,
           f.source,
           f.frozen_at
      from public.smart_target_forecasts f
     where f.session_date = p_date and f.shift = p_shift
     order by f.line;
end;
$$;

revoke all on function public.smart_target_line_targets(date, text) from public, anon;
grant execute on function public.smart_target_line_targets(date, text) to authenticated;

-- 04:30–05:50 and 16:30–17:50 UTC: in GMT the runs at 05:30/05:50 and 17:30/17:50 count,
-- in BST those at 04:30/04:50 and 16:30/16:50. The others return "no shift" at once.
-- cron.schedule with a name replaces a job of the same name, so a second paste is safe.
select cron.schedule(
  'smart-target-ahead',
  '30,50 4,5,16,17 * * *',
  $cron$
  select net.http_post(
    url := 'https://apblxaaktftinstoidvp.supabase.co/functions/v1/smart-target-ahead',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
