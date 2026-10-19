-- A reply rule cannot read its own table.
--
-- WHAT WAS THERE. BLOCO 102 added "dm_insert_reply" — anybody may answer somebody who
-- wrote to them — as a policy on `direct_messages` whose check asked
-- `exists (select 1 from public.direct_messages ...)`. A policy that reads its own
-- table makes Postgres expand that table's policies inside themselves, and production
-- refused it: `42P17 infinite recursion detected in policy for relation
-- "direct_messages"`. Every INSERT evaluates every permissive INSERT policy, so it was
-- not only replies that failed but every message sent in the app's chat, from the
-- paste of 102 (18/10 evening) until this one (19/10). The local test database did
-- not reproduce it; production did, on the first run of the 102 test.
--
-- WHAT THIS DOES. The question "has this person written to me?" moves into a SECURITY
-- DEFINER function, which reads the table without applying its policies — so nothing
-- recurses. It answers only about messages addressed to whoever asks, so nobody can
-- use it to learn who wrote to somebody else. Same rule, same name.
--
-- Pasted by hand on 19/10 before this file existed (COLAR-102b-corrige-chat.sql),
-- verified by probe: dm_wrote_to_me answers 401 to anon.
--
-- Guarded since: src/__tests__/aPolicyNeverReadsItsOwnTable.test.ts.

create or replace function public.dm_wrote_to_me(p_from uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  -- So responde sobre mensagens dirigidas a quem pergunta: ninguem descobre quem
  -- escreveu a outra pessoa.
  select exists (select 1 from public.direct_messages
                  where sender_id = p_from and recipient_id = auth.uid());
$$;
revoke all on function public.dm_wrote_to_me(uuid) from public, anon;
grant execute on function public.dm_wrote_to_me(uuid) to authenticated;

drop policy if exists "dm_insert_reply" on public.direct_messages;
create policy "dm_insert_reply" on public.direct_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and public.dm_wrote_to_me(recipient_id)
  );
