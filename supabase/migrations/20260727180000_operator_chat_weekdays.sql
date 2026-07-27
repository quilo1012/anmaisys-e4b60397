-- Extend operator chat config with per-weekday reachability (on top of shift).
-- An admin is reachable NOW only if the current shift AND the current weekday
-- are enabled. Daniel is set to a Fri/Sat/Sun/Mon weekend cover. Applied live.
ALTER TABLE public.operator_chat_admins
  ADD COLUMN IF NOT EXISTS mon boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tue boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS thu boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fri boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sat boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sun boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.is_operator_chat_admin_now(uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH t AS (SELECT (now() AT TIME ZONE 'Europe/London') AS ldt),
  s AS (
    SELECT
      (EXTRACT(HOUR FROM ldt) >= 6 AND EXTRACT(HOUR FROM ldt) < 18) AS is_day,
      EXTRACT(DOW FROM (CASE WHEN EXTRACT(HOUR FROM ldt) < 6 THEN ldt::date - 1 ELSE ldt::date END))::int AS dow
    FROM t
  )
  SELECT EXISTS (
    SELECT 1 FROM public.operator_chat_admins oca, s
    WHERE oca.user_id = uid
      AND (CASE WHEN s.is_day THEN oca.day ELSE oca.night END)
      AND (CASE s.dow WHEN 0 THEN oca.sun WHEN 1 THEN oca.mon WHEN 2 THEN oca.tue
                      WHEN 3 THEN oca.wed WHEN 4 THEN oca.thu WHEN 5 THEN oca.fri
                      WHEN 6 THEN oca.sat END)
  );
$function$;

UPDATE public.operator_chat_admins
SET mon=true, tue=false, wed=false, thu=false, fri=true, sat=true, sun=true
WHERE user_id = (SELECT id FROM public.profiles WHERE lower(email)='daniel.quilo@appliednutrition.uk');
