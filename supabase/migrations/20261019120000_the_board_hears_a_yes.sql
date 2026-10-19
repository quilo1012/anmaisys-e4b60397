-- The board hears a yes.
--
-- An employee's yes books the overtime (BLOCO 102/105) and the board lays the confirmed
-- hours over their placement (src/lib/boardOvertime.ts). The board learned of it only
-- when it refetched: neither `overtime_responses` nor `daily_allocations` was in the
-- realtime publication, so a supervisor looking at the board saw the old hours until
-- they reloaded or the 30-second refresh came round.
--
-- This puts both tables in `supabase_realtime`. Realtime delivers a change only to a
-- subscriber whose RLS lets them read that row, so nobody sees an answer or a placement
-- through this that they could not already select.
--
-- Idempotent; skips a table already in the publication.

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here; nothing to do.';
    return;
  end if;
  foreach t in array array['overtime_responses', 'daily_allocations'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
