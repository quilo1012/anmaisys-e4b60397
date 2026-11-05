-- APLICAR 147 — o Smart Target guarda a fila do iTouch uma vez por turno.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 147 do APPLY-ALL-IN-ORDER.sql, byte a byte. Depois do 146.
--
-- Porquê (Smart Target, Q26b): o plano no Production Control não traz quantidades até a
-- produção ser registada. A quantidade de cada encomenda está na fila do iTouch. A página
-- Smart Target lê essa fila uma vez por turno (quota de 100 MB/dia do iTouch) e guarda-a
-- aqui, para preencher as quantidades que faltam.
--
-- O que muda: uma tabela nova (smart_target_queue_snapshots) e uma função nova
-- (save_smart_target_queue), que guarda a primeira leitura de cada turno e recusa as
-- seguintes. Nada existente é alterado. Lê e grava quem tem smarttarget.view (admin,
-- production office), só pela função. O anon não tem acesso nenhum.
-- Pode colar-se duas vezes.
--
-- Depois de colar: correr VERIFY-147-fila-do-itouch.sql (só lê).
--
-- EN: Paste the whole file; it is BLOCO 147. It adds smart_target_queue_snapshots and
-- save_smart_target_queue(), which keeps the first queue read of each shift and refuses
-- later ones. Nothing existing changes; it can be pasted twice. Then run VERIFY-147.


-- ================================================================
-- BLOCO 147
-- 20261105150000_smart_target_queue_snapshot.sql
-- ================================================================
-- Smart Target: the iTouch queue, read once per shift and kept.
--
-- WHY. The plan rows in production_items carry no order quantity until production is
-- logged (0 of 8 on 05/11; 224 of 353 over two weeks, all filled in afterwards). The
-- quantity lives in iTouch's queue (OrderQty per works order, per machine). Reading that
-- queue costs iTouch egress, which has a 100 MB daily cap, so Smart Target reads it once
-- per shift and keeps it here. Decided 05/11, Q26(b).
--
-- WHAT IS STORED. Per date, shift and line: each queued job's position, part code, order
-- quantity and the quantity already made, as iTouch reported them, plus when they were
-- read. Nothing is derived here; the page decides what is left to make.
--
-- ONCE PER SHIFT, FIRST READ WINS. save_smart_target_queue() refuses to overwrite a
-- shift that already has a snapshot, so the queue a forecast used cannot change under it
-- later in the shift, and two people opening the page at once cannot double the rows.
--
-- WHO. Reading and saving follow the page: smarttarget.view. Writing only through the
-- function. No anon access.

create table if not exists public.smart_target_queue_snapshots (
  id            uuid primary key default gen_random_uuid(),
  session_date  date not null,
  shift         text not null check (shift in ('DAY', 'NIGHT')),
  line          text not null,
  seq           integer not null,
  sku           text not null,
  order_qty     numeric,
  done_qty      numeric,
  status        text,
  fetched_at    timestamptz not null default now(),
  fetched_by    uuid
);

create index if not exists smart_target_queue_snapshots_shift_idx
  on public.smart_target_queue_snapshots (session_date, shift);

alter table public.smart_target_queue_snapshots enable row level security;

revoke all on public.smart_target_queue_snapshots from anon, public;
grant select on public.smart_target_queue_snapshots to authenticated;
grant all on public.smart_target_queue_snapshots to service_role;

drop policy if exists "smart_target_queue_snapshots read with smart target"
  on public.smart_target_queue_snapshots;
create policy "smart_target_queue_snapshots read with smart target"
  on public.smart_target_queue_snapshots
  for select
  to authenticated
  using (public.has_action((select auth.uid()), 'smarttarget.view',
                           array['admin', 'production_office_admin']::app_role[]));

create or replace function public.save_smart_target_queue(p_date date, p_shift text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'smarttarget.view',
                              array['admin', 'production_office_admin']::app_role[]) then
    raise exception 'Not allowed to save the iTouch queue.' using errcode = '42501';
  end if;
  if p_shift not in ('DAY', 'NIGHT') then
    raise exception 'Shift must be DAY or NIGHT.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The queue must be a list.' using errcode = '22023';
  end if;

  -- Two people opening the page at the same moment: the second waits here and then
  -- finds the first one's snapshot.
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
grant execute on function public.save_smart_target_queue(date, text, jsonb) to authenticated;
