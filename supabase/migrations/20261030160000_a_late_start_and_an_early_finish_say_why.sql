-- A late start and an early finish say why.
--
-- WHAT WAS ASKED. 30/10/2026, the owner, on the Headcount board's day dialog: a notes field
-- for the reason somebody arrived late or went home early. The board could say Talita
-- Melech went home at 11:00 and nothing about why, so a doctor's appointment and walking
-- off the line read the same.
--
-- WHY NOT `note`. The row already has `note`, and the sheet import writes into it ("First
-- name only on the sheet — …", 21 rows). A reason typed by a supervisor would overwrite
-- that, or be overwritten by the next import. So each time gets a reason of its own.
--
-- WHAT IT ADDS. Two nullable text columns on daily_allocations, at most 300 characters each,
-- and a trigger that trims them and clears a reason when its time is cleared — by the
-- dialog, by a status change, or by any other writer — so a reason never outlives the late
-- start or early finish it explains. Nothing existing is changed and no data is touched.
-- Can be run twice.

alter table public.daily_allocations
  add column if not exists arrived_late_reason text,
  add column if not exists left_early_reason text;

do $$
begin
  alter table public.daily_allocations
    add constraint daily_allocations_late_early_reason_length
    check (char_length(coalesce(arrived_late_reason, '')) <= 300
       and char_length(coalesce(left_early_reason, '')) <= 300);
exception when duplicate_object then
  null;
end;
$$;

comment on column public.daily_allocations.arrived_late_reason is
  'Why they came in late (arrived_late_at). Typed on the Headcount day dialog; cleared with the time.';
comment on column public.daily_allocations.left_early_reason is
  'Why they went home early (left_early_at). Typed on the Headcount day dialog; cleared with the time.';

create or replace function public.late_early_reason_follows_the_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.arrived_late_reason := nullif(btrim(new.arrived_late_reason), '');
  new.left_early_reason := nullif(btrim(new.left_early_reason), '');
  if new.arrived_late_at is null then
    new.arrived_late_reason := null;
  end if;
  if new.left_early_at is null then
    new.left_early_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_late_early_reason_follows_the_time on public.daily_allocations;
create trigger trg_late_early_reason_follows_the_time
  before insert or update on public.daily_allocations
  for each row execute function public.late_early_reason_follows_the_time();

notify pgrst, 'reload schema';
