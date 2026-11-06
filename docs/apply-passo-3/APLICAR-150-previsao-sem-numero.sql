-- APLICAR 150 — uma previsão guardada sem número pode ser substituída por uma com número.
--
-- PT: Colar no SQL Editor do AN Maintenance (Supabase), o ficheiro inteiro. É o BLOCO 150 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Depois do 149. Uma previsão com número nunca muda.
-- Só muda a função save_smart_target_forecasts. Pode colar-se duas vezes. Depois correr
-- VERIFY-150-previsao-sem-numero.sql (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 150. A forecast
-- with a number never changes. Only save_smart_target_forecasts changes. Then run VERIFY-150.

-- ================================================================
-- BLOCO 150
-- 20261106090000_smart_target_no_number_replaced.sql
-- ================================================================
-- Smart Target: a forecast saved without a number can be replaced by one with a number.
--
-- WHY. The first save per line wins, so a forecast never moves once made. On 06/11 Line 6
-- saved "no number" through a defect, and that empty row then stayed the shift's forecast
-- and what the tablet read. The rule protects a number; an empty row has none to protect.
-- Decided 06/11, Q57a.
--
-- WHAT CHANGES. save_smart_target_forecasts() only. A row with a number is still never
-- touched. A row without one takes the new values, frozen_at included, so a replacement
-- made late counts as made late and cannot improve the measurement.

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

  insert into public.smart_target_forecasts as f
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
  on conflict (session_date, shift, line) do update
    set shown = excluded.shown,
        expected_total = excluded.expected_total,
        expected_per_hour = excluded.expected_per_hour,
        status = excluded.status,
        confidence = excluded.confidence,
        factor = excluded.factor,
        factor_shifts = excluded.factor_shifts,
        jobs = excluded.jobs,
        engine_version = excluded.engine_version,
        frozen_by = excluded.frozen_by,
        frozen_at = now(),
        source = excluded.source,
        queue_read_at = excluded.queue_read_at,
        notes = excluded.notes
    where f.expected_total is null and excluded.expected_total is not null;

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('saved', v_inserted);
end;
$$;

revoke all on function public.save_smart_target_forecasts(date, text, jsonb) from public, anon;
grant execute on function public.save_smart_target_forecasts(date, text, jsonb) to authenticated, service_role;
