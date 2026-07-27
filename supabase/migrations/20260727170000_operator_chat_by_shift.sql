-- Configurable, per-shift operator chat: operators only see the admins enabled
-- for the shift that's running. Replaces the hardcoded email list in
-- is_operator_chat_admin with a table. Applied live; kept for the record.

CREATE TABLE IF NOT EXISTS public.operator_chat_admins (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  day boolean NOT NULL DEFAULT true,
  night boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operator_chat_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oca manage" ON public.operator_chat_admins;
CREATE POLICY "oca manage" ON public.operator_chat_admins FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

-- Seed the previously-hardcoded admins on both shifts (preserves prior behaviour).
INSERT INTO public.operator_chat_admins (user_id, day, night)
SELECT p.id, true, true FROM public.profiles p
WHERE lower(p.email) IN (
  'daniel.quilo@appliednutrition.uk','ivan.zuccolotto@appliednutrition.uk',
  'abner.silva@appliednutrition.uk','elias.soares@appliednutrition.uk',
  'gustavo.mafrabraz@appliednutrition.uk','maikon.rosa@appliednutrition.uk'
)
ON CONFLICT (user_id) DO NOTHING;

-- Reachable on either shift (used for the admin -> operator reverse direction).
CREATE OR REPLACE FUNCTION public.is_operator_chat_admin(uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.operator_chat_admins WHERE user_id = uid AND (day OR night));
$function$;

-- Reachable on the CURRENT London shift (Day 06:00-17:59, else Night).
CREATE OR REPLACE FUNCTION public.is_operator_chat_admin_now(uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.operator_chat_admins oca
    WHERE oca.user_id = uid
      AND CASE
            WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/London')) >= 6
             AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/London')) < 18
            THEN oca.day ELSE oca.night END
  );
$function$;

-- Operator branch now filters admins by the current shift (via _now); the
-- admin->operator reverse still uses the either-shift check so admins can reply
-- any time. (Full body recreated in the live DB — see migration for context.)
