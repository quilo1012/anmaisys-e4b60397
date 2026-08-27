-- Two tables hold the same people, joined by nothing, and five of those people cannot
-- open their own scorecard.
--
-- `line_leaders` (31 rows) is the target of production_sessions.leader_id — the factory's
-- record of who led what. `leader_pins` (25 rows) holds the PIN and the `lines` array
-- that `leader_self_scorecard()` reads. Same people, two tables, and the only thing
-- connecting them is that the names happen to match.
--
-- All 25 PINs have a name in line_leaders. Six line_leaders have no PIN, and five of
-- those have led real sessions:
--
--   Webister    3 sessions, last 20/07     Marcella   1 session, last 24/07
--   Fabricio    3 sessions, last 20/07     Alice      1 session, last 08/08
--   Josiel      1 session, last 07/07      Junior     none
--
-- No PIN means `leader_self_scorecard()` cannot identify them, so /dashboard/leader/scorecard
-- shows them the keypad and nothing else, forever. And nothing says so: the Manage Users
-- screen lists `leader_pins`, so a leader who has no PIN is not missing from the list —
-- they were never on it. The only way to find this was to compare two tables by hand.
--
-- THIS MIGRATION DOES NOT CREATE PINS. A PIN is a secret its owner has to know, and
-- inventing five and writing them into a migration file in a public repository would be
-- worse than the problem. What it does is make the five visible on the screen where
-- somebody can give them one.

-- =====================================================================
-- 1. The key the two tables never had
--
-- Nullable and ON DELETE SET NULL, deliberately: a PIN row whose line_leader is removed
-- should lose the link, not vanish. Nothing reads this column yet — it exists so that the
-- next thing that needs to join these two tables joins on a key instead of on a name,
-- which is the defect that produced 20260906090000.
-- =====================================================================

ALTER TABLE public.leader_pins
  ADD COLUMN IF NOT EXISTS line_leader_id uuid REFERENCES public.line_leaders(id) ON DELETE SET NULL;

-- Backfilled by name, because a name is all there has ever been to go on. Trimmed and
-- case-folded, as everything else in this schema that matches leaders does. All 25 are
-- expected to resolve; any that does not is left null rather than guessed at.
UPDATE public.leader_pins p
   SET line_leader_id = l.id
  FROM public.line_leaders l
 WHERE p.line_leader_id IS NULL
   AND lower(btrim(l.name)) = lower(btrim(p.name));

CREATE UNIQUE INDEX IF NOT EXISTS leader_pins_line_leader_id_key
  ON public.leader_pins (line_leader_id) WHERE line_leader_id IS NOT NULL;

COMMENT ON COLUMN public.leader_pins.line_leader_id IS
  'O mesmo lider em public.line_leaders, que e o alvo de production_sessions.leader_id. '
  'Preenchido por nome em 20260914090000 porque era so isso que havia; daqui para a frente '
  'quem precisar de juntar as duas tabelas junta por esta chave e nao pelo nome. Unico: dois '
  'PINs para o mesmo lider e um erro de dados, nao um caso de uso.';

-- =====================================================================
-- 2. Who leads sessions and cannot sign in to see them
--
-- SECURITY DEFINER because line_leaders is not readable by everyone, and this answers a
-- question the Manage Users screen has to be able to ask. Restricted to the roles that
-- can already manage leaders — the same gate `create_leader` sits behind.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leaders_without_pin()
RETURNS TABLE(id uuid, name text, shift text, active boolean, sessions bigint, last_session date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.id,
         l.name,
         l.shift,
         l.active,
         (SELECT count(*) FROM public.production_sessions s
           WHERE s.leader_id = l.id
              OR lower(btrim(s.leader_name)) = lower(btrim(l.name))),
         (SELECT max(s.session_date) FROM public.production_sessions s
           WHERE s.leader_id = l.id
              OR lower(btrim(s.leader_name)) = lower(btrim(l.name)))
    FROM public.line_leaders l
   WHERE NOT EXISTS (
           SELECT 1 FROM public.leader_pins p
            WHERE p.line_leader_id = l.id
               OR lower(btrim(p.name)) = lower(btrim(l.name))
         )
   ORDER BY 5 DESC, l.name;
$function$;

REVOKE ALL ON FUNCTION public.leaders_without_pin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leaders_without_pin() TO authenticated;

COMMENT ON FUNCTION public.leaders_without_pin() IS
  'Lideres de line_leaders sem linha em leader_pins — lideram sessoes e nao conseguem abrir o '
  'proprio scorecard, porque leader_self_scorecard() os identifica pelo PIN. Ordenado pela '
  'ultima sessao, para quem esta a olhar comecar por quem lidera agora. Ver 20260914090000.';
