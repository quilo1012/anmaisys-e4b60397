-- Presence: the heartbeat writes a marker only when somebody comes online, not on every beat.
--
-- WHAT HAPPENED. On 10/11/2026 AN Maintenance (Micro compute, 1 GB) was timing out queries
-- on tables of ten thousand rows. pg_stat_statements over 17 minutes put the presence system
-- at the top: communication_touch_presence 164 calls, communication_my_availability 469,
-- and the Realtime WAL reader 2,026. communication_presence_changes had 165 writes in the
-- same window, one per heartbeat.
--
-- WHY. Every open tab calls communication_touch_presence() every 60 seconds to renew its
-- 180-second lease, and the function also bumped this user's row in
-- communication_presence_changes on every call. That table is in supabase_realtime, and
-- PresenceHeartbeat re-reads the presence list and "my availability" on every marker. So N
-- open tabs made every one of the M listening tabs re-read twice a minute per beat: N x M
-- reads a minute for a lease renewal that changes nobody's status.
--
-- THE FIX. The marker is for "somebody connected, disconnected or changed their choice"
-- (PresenceHeartbeat says so). A renewal of a live lease is none of those, so only the beat
-- that finds no live lease for this user writes it. Going offline is still seen by the
-- 30-second presence refresh and the 180-second lease, as before; ending a tab and changing
-- a choice are other functions and keep their own markers. Grants are kept by
-- CREATE OR REPLACE.

create or replace function public.communication_touch_presence(p_tab_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_me uuid := public.communication_presence_actor();
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  v_now timestamptz := clock_timestamp();
  v_was_online boolean;
begin
  if p_tab_id is null or v_session is null then
    raise exception 'An authenticated session and tab are required' using errcode = '42501';
  end if;
  -- Serialize cap checks per account so concurrent new UUIDs cannot bypass it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_me::text, 0));
  -- Bound storage for the returning account; no scheduled job or cross-user writes.
  delete from public.communication_connection_leases l where l.user_id = v_me and l.expires_at <= v_now;
  -- Any lease left is live: this user is already online, from this tab or another.
  v_was_online := exists (select 1 from public.communication_connection_leases l where l.user_id = v_me);
  if not exists (select 1 from public.communication_connection_leases l
      where l.user_id = v_me and l.auth_session_id = v_session and l.tab_id = p_tab_id)
     and (select count(*) from public.communication_connection_leases l where l.user_id = v_me) >= 32 then
    raise exception 'Too many active presence sessions' using errcode = '54000';
  end if;
  insert into public.communication_connection_leases(user_id, auth_session_id, tab_id, expires_at)
    values (v_me, v_session, p_tab_id, v_now + interval '180 seconds')
    on conflict (user_id, auth_session_id, tab_id) do update set expires_at = excluded.expires_at;
  if not v_was_online then
    insert into public.communication_presence_changes(user_id, revision) values (v_me, gen_random_uuid())
      on conflict (user_id) do update set revision = excluded.revision;
  end if;
end;
$function$;
