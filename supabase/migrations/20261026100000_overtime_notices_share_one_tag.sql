-- The notices about one overtime ask share one tag on the phone.
--
-- WHAT WAS THERE. `notification_push` (BLOCO 117) tags every push `<kind>:<row id>`. Each
-- bell row is its own notification on the lock screen, so a person told "Overtime
-- changed: now 20:00" and then "Overtime cancelled" kept both, the older one still
-- showing hours that no longer exist. The reminders coming in BLOCO 133 would add a third.
--
-- WHAT THIS DOES. For 'overtime_changed', 'overtime_cancelled', 'overtime_reminder_24h'
-- and 'overtime_reminder_2h' rows that name their ask (overtime_request_id), the tag is
-- `overtime-notice-<request id>`. The service worker already sets `renotify` whenever
-- there is a tag, so the newest notice replaces the one on screen and still buzzes.
-- Tapping it marks every unread notice of those kinds for that ask read
-- (useOpenedNotification); the app learns that tag in the same pull request.
--
-- Every other row keeps `<kind>:<id>`. `overtime_new` is not sent by this trigger at all
-- (the browser pushes it as `overtime-ask-<id>`), and `overtime_booked` has no
-- overtime_request_id, so neither moves.
--
-- Only the function body changes. The triggers `notification_push` and
-- `notification_push_again` already point at it and are not touched. No table, column
-- or data changes. Safe to apply before or after the app and `send-push` deploy: the
-- tag is a field send-push has always accepted, and an app that does not know the new
-- tag yet only leaves that notice unread in the bell.

create or replace function public.notification_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
      return null;
    end if;

    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
    if v_secret is null then
      raise warning 'notification_push(%): CRON_SECRET missing from the vault', new.id;
      return null;
    end if;

    perform net.http_post(
      url := 'https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      ),
      body := jsonb_strip_nulls(jsonb_build_object(
        'user_id', new.user_id,
        'title', left(coalesce(nullif(new.title, ''), 'PMSystem'), 200),
        'body', left(new.body, 2000),
        'priority', case when new.priority in ('low', 'medium', 'high', 'critical')
                         then new.priority else 'medium' end,
        -- BLOCO 132: the notices about one ask share one tag, so on the phone each
        -- replaces the last (a cancellation covers the reminder it makes wrong). The page
        -- reads `overtime-notice-<ask>` back in notificationOpen.ts; the kinds must match
        -- OVERTIME_NOTICE_KINDS there. Every other row keeps `<kind>:<id>`.
        'tag', left(case
                      when new.overtime_request_id is not null
                       and new.kind in ('overtime_changed', 'overtime_cancelled',
                                        'overtime_reminder_24h', 'overtime_reminder_2h')
                      then 'overtime-notice-' || new.overtime_request_id
                      else new.kind || ':' || new.id
                    end, 100),
        'action_url', left(new.action_url, 2048),
        'wo_id', new.wo_id,
        'in_app', false
      )),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notification_push(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.notification_push() from public, anon, authenticated;

notify pgrst, 'reload schema';
