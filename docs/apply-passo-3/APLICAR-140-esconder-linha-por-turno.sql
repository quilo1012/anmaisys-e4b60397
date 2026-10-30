-- APLICAR 140 — esconder uma linha num turno, no Headcount.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 140 do APPLY-ALL-IN-ORDER.sql, byte a byte. Não depende de nenhum bloco por colar.
--
-- O que muda: uma tabela nova, headcount_area_hidden (linha + turno), com RLS. Não altera
-- linhas, alocações, funções nem dados existentes. Pode colar-se duas vezes.
--
-- EN: Paste the whole file; it is BLOCO 140. One new table with RLS; no existing data touched.


-- ================================================================
-- BLOCO 140
-- 20261030190000_a_line_can_be_hidden_on_one_shift.sql
-- ================================================================
-- A line can be hidden on one shift.
--
-- WHAT WAS ASKED. 30/10/2026, the owner, on the Headcount board: hide the lines a shift is
-- not using, separately for Day and Night, without deleting anything. Measured on the live
-- data since 01/10: the Night board used between 2 and 10 of the 13 production lines on a
-- night, the Day board between 7 and 12, so thirteen empty-or-not columns every night is
-- mostly empty columns.
--
-- WHY A TABLE AND NOT `headcount_areas.active`. `active` is one answer for both boards, and
-- the whole point is that Night hides Line 4 while Day keeps it. A row here says "this
-- line is hidden on this shift"; no row means shown. The owner chose shared over
-- per-browser, so hiding a line in the office hides it on every tablet on that shift.
--
-- WHAT IT DOES NOT TOUCH. The line itself, its people and every allocation, past or
-- present. Hiding is drawing: a hidden line that has somebody on it that day is still
-- drawn (the board says it is hidden), so nobody is taken off the headcount by a filter.
-- Deleting a line deletes its rows here (cascade), and nothing else follows from a row.
--
-- WHO. Anyone signed in reads it — it holds a line id and a shift, nothing about a person
-- — and the same five roles that may write the board's allocations may change it.
-- Can be run twice.

create table if not exists public.headcount_area_hidden (
  area_id uuid not null references public.headcount_areas(id) on delete cascade,
  shift text not null check (shift in ('Day', 'Night')),
  hidden_by uuid default auth.uid(),
  hidden_at timestamptz not null default now(),
  primary key (area_id, shift)
);

comment on table public.headcount_area_hidden is
  'Lines hidden on one Headcount board (Day or Night). A row hides the column on that shift only; no row = shown. Never affects allocations.';

alter table public.headcount_area_hidden enable row level security;

drop policy if exists headcount_area_hidden_read on public.headcount_area_hidden;
create policy headcount_area_hidden_read on public.headcount_area_hidden
  for select to authenticated
  using (true);

drop policy if exists headcount_area_hidden_write on public.headcount_area_hidden;
create policy headcount_area_hidden_write on public.headcount_area_hidden
  for all to authenticated
  using (
    has_role(auth.uid(), 'admin'::app_role)
    or has_role(auth.uid(), 'manager'::app_role)
    or has_role(auth.uid(), 'supervisor'::app_role)
    or has_role(auth.uid(), 'planner'::app_role)
    or has_role(auth.uid(), 'production_office_admin'::app_role)
  )
  with check (
    has_role(auth.uid(), 'admin'::app_role)
    or has_role(auth.uid(), 'manager'::app_role)
    or has_role(auth.uid(), 'supervisor'::app_role)
    or has_role(auth.uid(), 'planner'::app_role)
    or has_role(auth.uid(), 'production_office_admin'::app_role)
  );

grant select, insert, delete on public.headcount_area_hidden to authenticated;
revoke all on public.headcount_area_hidden from anon;

notify pgrst, 'reload schema';
