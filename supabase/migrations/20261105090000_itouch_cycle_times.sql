-- iTouch's standard cycle times, loaded from its "Product Details" export.
--
-- WHY. Smart Target's rate is iTouch's ideal cycle per product and machine, scaled by
-- how each line really runs (src/lib/smartTargetRates.ts). The cycle lives only in an
-- Excel that iTouch exports, so Production loads it from the Smart Target page and the
-- page reads it back from here.
--
-- WHAT IS STORED. The export as it comes: machine name, part code, seconds per cycle,
-- containers per cycle, and which file it came from. Nothing is cleaned here. Deciding
-- what is usable (only Filler Line 1–6, plausible seconds, one value per line and SKU) is
-- cleanCycles()'s job, and it lists every rejected row for Production instead of dropping
-- it. For the same reason there is NO unique key on (machine, sku): if iTouch ever holds
-- two cycle times for one product on one machine, that must reach cleanCycles as a
-- conflict, not be resolved here by whichever row came last.
--
-- WHO. Reading follows the page: smarttarget.view. Writing is only through
-- import_itouch_cycles(), which requires sku.manage ("Create, edit or import SKUs and
-- speeds"). Baselines mirror MATRIX in src/lib/permissions.ts. No anon access at all.
--
-- HOW AN IMPORT WORKS. The export is a complete snapshot, so an import replaces the whole
-- table in one transaction. An empty import is refused rather than emptying the table.

create table if not exists public.itouch_cycle_times (
  id             uuid primary key default gen_random_uuid(),
  machine        text not null,
  sku            text not null,
  cycle_seconds  numeric,
  cavities       numeric,
  source         text not null,
  imported_at    timestamptz not null default now(),
  imported_by    uuid
);

create index if not exists itouch_cycle_times_machine_sku_idx
  on public.itouch_cycle_times (machine, sku);

alter table public.itouch_cycle_times enable row level security;

revoke all on public.itouch_cycle_times from anon, public;
grant select on public.itouch_cycle_times to authenticated;
grant all on public.itouch_cycle_times to service_role;

drop policy if exists "itouch_cycle_times read with smart target"
  on public.itouch_cycle_times;
create policy "itouch_cycle_times read with smart target"
  on public.itouch_cycle_times
  for select
  to authenticated
  using (public.has_action((select auth.uid()), 'smarttarget.view',
                           array['admin', 'production_office_admin']::app_role[]));

create or replace function public.import_itouch_cycles(p_rows jsonb, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_machines integer;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'sku.manage',
                              array['admin', 'manager', 'production_office_admin']::app_role[]) then
    raise exception 'Not allowed to import iTouch cycle times.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The import has no rows; the cycle times already loaded were kept.'
      using errcode = '22023';
  end if;
  if coalesce(btrim(p_source), '') = '' then
    raise exception 'The import must say which file it came from.' using errcode = '22023';
  end if;

  delete from public.itouch_cycle_times where true;

  insert into public.itouch_cycle_times (machine, sku, cycle_seconds, cavities, source, imported_by)
  select btrim(r->>'machine'),
         btrim(r->>'sku'),
         nullif(r->>'cycle_seconds', '')::numeric,
         nullif(r->>'cavities', '')::numeric,
         btrim(p_source),
         auth.uid()
    from jsonb_array_elements(p_rows) as r
   where coalesce(btrim(r->>'machine'), '') <> ''
     and coalesce(btrim(r->>'sku'), '') <> '';

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'No row had both a machine and a part code; nothing was imported.'
      using errcode = '22023';
  end if;

  select count(distinct machine) into v_machines from public.itouch_cycle_times;
  return jsonb_build_object('inserted', v_inserted, 'machines', v_machines);
end;
$$;

revoke all on function public.import_itouch_cycles(jsonb, text) from public, anon;
grant execute on function public.import_itouch_cycles(jsonb, text) to authenticated;
