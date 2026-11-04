-- APLICAR 144 — a presença do Communication Hub deixa de dar timeout.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 144 do APPLY-ALL-IN-ORDER.sql, byte a byte. Não depende do 142 nem do 143.
--
-- Porquê (04/11): communication_presence_for dava 500 (57014, statement timeout) no Hub
-- do maintenance manager. A verificação de quem pode ver quem reconstruía a lista inteira
-- de contactos uma vez por cada pessoa do Hub. Agora pergunta a regra só para essa pessoa.
-- Quem vê quem não muda. Pode colar-se duas vezes.
--
-- Depois de colar: correr VERIFY-144-presenca-sem-timeout.sql (só lê). A linha: ok.
--
-- EN: Paste the whole file; it is BLOCO 144. communication_can_view_presence stops
-- rebuilding the whole contact list per person. Then run VERIFY-144.


-- ================================================================
-- BLOCO 144
-- 20261104120000_presence_asks_the_rule_per_person_not_the_whole_list.sql
-- ================================================================
-- Presence asks the chat rule about one person at a time, not the whole list per person.
--
-- WHAT WAS WRONG. 04/11/2026: the Communication Hub of a maintenance manager logged
-- `communication_presence_for → 500 (57014 statement timeout)` twice in two minutes.
-- communication_can_view_presence(p_target) asked
-- `exists (select 1 from chat_contactable_people() c where c.user_id = p_target)`, and
-- chat_contactable_people() builds the caller's WHOLE contact list — every profile, through
-- chat_may_start and an employees lookup, sorted. presence_for calls can_view once per
-- person, so a list of N people built the list N times: N × all profiles. A security
-- definer SQL function is never inlined, so the planner could not fold it away. The roles
-- that may write to nearly everyone (admin, manager, maintenance_manager, warehouse,
-- supervisor) get the longest Hub list and pay the most.
--
-- Measured on a local copy with 400 profiles, as a maintenance manager: 31.9 s before,
-- 83 ms after. Same answer for every (caller, target) pair across five roles (2000 pairs,
-- 0 differences).
--
-- WHAT CHANGES. Membership of chat_contactable_people() for an active target that is not
-- you is exactly `chat_may_start(you, target) or target in my_supervisor()` — that is the
-- function's own WHERE. That is what is asked now, for that one person. Every other line
-- of the function is the same, and so is who can see whom.
--
-- WHAT DOES NOT CHANGE. chat_contactable_people() itself, the Hub list, the grants
-- (CREATE OR REPLACE keeps them), and the realtime policy that calls this as the invoker
-- (it gets faster too). Idempotent.

create or replace function public.communication_can_view_presence(p_target uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles me where me.id = auth.uid() and coalesce(me.active, true))
    and exists (select 1 from public.profiles p where p.id = p_target and coalesce(p.active, true))
    and (
      p_target = auth.uid()
      or public.chat_may_start(auth.uid(), p_target)
      or exists (select 1 from public.my_supervisor() s where s.user_id = p_target)
      or exists (select 1 from public.direct_messages d
        where (d.sender_id = auth.uid() and d.recipient_id = p_target)
           or (d.recipient_id = auth.uid() and d.sender_id = p_target))
      or exists (select 1 from public.chat_group_members m
        where m.user_id = p_target and m.left_at is null
          and public.chat_is_member(auth.uid(), m.group_id))
    );
$$;
