-- The weekly scorecard view answers as the person asking again, and anon is off it.
--
-- WHAT WAS WRONG. Audit 2026-11-02, DB-001. Production showed v_leader_weekly_scorecard
-- with security_invoker off while SELECT was granted to anon. A view without
-- security_invoker runs as its owner, so the public key in the bundle read the leaders'
-- weekly scores past every RLS policy on leader_weekly_scorecard and the tables it joins.
--
-- WHY. 20260826090000 made the view WITH (security_invoker = true). 20261001203000
-- rebuilt it from pg_get_viewdef with `CREATE OR REPLACE VIEW … AS`, and a CREATE OR
-- REPLACE without a WITH clause resets the view's options: security_invoker went with
-- it. The other scorecard views were never rebuilt that way and are still on.
--
-- WHAT CHANGES. The option goes back on, without touching the definition, and anon loses
-- its grant on this view. Signed-in readers see what RLS lets them see, as they did from
-- 26/08 to 01/10. Idempotent.

alter view public.v_leader_weekly_scorecard set (security_invoker = true);

revoke all on public.v_leader_weekly_scorecard from anon;
