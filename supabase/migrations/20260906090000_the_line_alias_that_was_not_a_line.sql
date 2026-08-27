-- Three leaders whose scorecard has always read zero, because their line is a name
-- nothing else uses.
--
-- `leader_pins.lines` is how the personal scorecard decides what belongs to a leader:
-- `leader_self_scorecard()` reads it and filters production, RAG and quality actions by
-- line NAME. There is no foreign key on it — it is a `text[]`, typed by hand — and four
-- rows carry the value 'Capsules & Tablets'.
--
-- That string is not in `public.lines`. It is not in `production_sessions.line`, or
-- `rag_weekly_entries.line`, or `production_downtimes.line`, or `quality_actions.line`.
-- It is not a line. It is somebody writing down the AREA a leader covers, in a field
-- that is matched literally against line names.
--
-- Measured on 26/08/2026:
--
--   leader    lines                                sessions  RAG  quality
--   Gill      Capsules & Tablets                          0    0        0
--   Liana     Capsules & Tablets                          0    0        0
--   Muriel    Capsules & Tablets                          0    0        0
--   JULIANO   Capsules & Tablets + Line 1..6            444  560       62   <- saved by the rest
--
-- The work is there. It is filed under the line names the floor actually uses:
--
--   production_sessions, by leader_name
--     Tablet Line ......... 56 sessions — Alice, Gill, Juliano, Liana, Muriel
--     Capsules Machine 1 .. 16 sessions — Fabricio, Gill, Webister
--     Capsules Machine 2 .. 15 sessions — Fabricio, Webister
--
-- So this is not an empty screen because a leader did nothing. It is an empty screen
-- because the key is a string nobody constrained, and three people have been appraised
-- against a card that could never have shown anything.
--
-- WHY THESE THREE LINES AND NOT THE HISTORY. The obvious alternative is to give each
-- leader exactly the lines they have already worked — Gill would get Tablet Line and
-- Capsules Machine 1, Liana and Muriel only Tablet Line. That reads the past as if it
-- were the assignment, and it would silently narrow a leader's card the first time they
-- cover a machine they have not covered before.
--
-- 'Capsules & Tablets' names a group, and the group has three members: the two capsule
-- machines and the tablet line. GEL Line is deliberately NOT one of them — it is neither
-- capsules nor tablets, and its sessions belong to Josiel. Expanding the alias to its
-- members keeps what the person meant and takes nothing away from anyone.
--
-- Corroborated independently by `leader_line_assignment`, the curated leader-to-line
-- table written on 17/08: it maps Muriel to Tablet Line, and every other row in it
-- matches where that leader's sessions actually are.
--
-- AFTER THIS, measured by simulation before it was written:
--
--   Gill / Liana / Muriel   0 -> 87 sessions, 0 -> 85 RAG rows, 0 -> 852 downtimes
--   JULIANO               444 -> 531 sessions
--   orphan values left in leader_pins.lines: 0

-- =====================================================================
-- 1. Expand the alias into the lines it stands for
--
-- Written against the VALUE, not against four leader ids: if the same string was typed
-- into a fifth row tomorrow, this still means the same thing. Idempotent — running it
-- twice is a no-op, because the alias is gone after the first pass.
-- =====================================================================

UPDATE public.leader_pins lp
   SET lines = sub.novo,
       updated_at = now()
  FROM (
    SELECT p.id,
           (SELECT array_agg(DISTINCT v ORDER BY v)
              FROM unnest(
                     array_remove(p.lines, 'Capsules & Tablets')
                     || ARRAY['Capsules Machine 1', 'Capsules Machine 2', 'Tablet Line']
                   ) AS v) AS novo
      FROM public.leader_pins p
     WHERE 'Capsules & Tablets' = ANY(p.lines)
  ) AS sub
 WHERE lp.id = sub.id;

-- The legacy singular column carries the same alias on the same four rows. Nothing
-- reads it — `leader_self_scorecard` uses `lines`, and a row that says "Line 1" while
-- the array says all six proves it has not been maintained — but leaving a known-bad
-- value behind is how the next reader concludes the alias is still in use somewhere.
UPDATE public.leader_pins
   SET line = NULL
 WHERE line = 'Capsules & Tablets';

-- =====================================================================
-- 2. Stop it happening again
--
-- The root cause is not the four rows. It is that `lines` is a free-text array matched
-- against a catalogue nothing checks it against. A CHECK constraint cannot reach another
-- table, so the guard is a trigger.
--
-- It fires on write only: existing rows are not revalidated, so this cannot fail on data
-- already in the table. Verified before writing that the alias was the ONLY orphan value
-- across every row of leader_pins, active or not — so after section 1 there is nothing
-- left for this to trip over.
--
-- P0001 is the code the app's error handler passes through untouched, so the message
-- below is what the person sees, rather than "Something did not load".
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leader_pins_lines_must_exist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _desconhecidas text[];
BEGIN
  IF NEW.lines IS NULL OR cardinality(NEW.lines) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT v ORDER BY v) INTO _desconhecidas
    FROM unnest(NEW.lines) AS v
   WHERE NOT EXISTS (SELECT 1 FROM public.lines l WHERE l.name = v);

  IF _desconhecidas IS NOT NULL THEN
    RAISE EXCEPTION
      'Estas linhas nao existem no catalogo: %. Um lider so pode ser atribuido a uma linha que exista em Lines — se e uma area com varias linhas, escolha-as uma a uma.',
      array_to_string(_desconhecidas, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_leader_pins_lines_must_exist ON public.leader_pins;
CREATE TRIGGER trg_leader_pins_lines_must_exist
  BEFORE INSERT OR UPDATE OF lines ON public.leader_pins
  FOR EACH ROW EXECUTE FUNCTION public.leader_pins_lines_must_exist();

COMMENT ON FUNCTION public.leader_pins_lines_must_exist() IS
  'Recusa uma linha que nao exista em public.lines. leader_pins.lines e comparado por NOME '
  'contra production_sessions/rag_weekly_entries/quality_actions, por isso um nome errado nao '
  'da erro nenhum — da um scorecard a zero. Ver 20260906090000: Gill, Liana e Muriel estiveram '
  'assim desde sempre com o valor ''Capsules & Tablets''.';

COMMENT ON COLUMN public.leader_pins.line IS
  'LEGADA — nao usar. A fonte da verdade e leader_pins.lines (text[]), que e o que '
  'leader_self_scorecard() le. Esta coluna chegou a dizer "Line 1" para lideres cujo array '
  'cobre as seis linhas. Mantida so para nao partir leituras antigas; sem escritor.';
