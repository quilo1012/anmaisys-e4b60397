-- A failed CCP is a ceiling, not a number of points.
--
-- Fail CCP and Foreign Body were priced like Pallet and Office — points, in the same
-- plane, feeding the same averages. Points average out. A leader could close a quarter
-- in green having had a critical control point fail in it, because eleven good weeks
-- diluted one bad day. In a BRC/HACCP plant that is not a scoring preference, it is an
-- audit finding: the system cannot show that a food safety deviation was treated as
-- one.
--
-- THE MECHANISM ALREADY EXISTS AND IS NOT REBUILT HERE. 20260818090000 established the
-- sentence this module is organised around — "Production, Quality and Documentation are
-- WEIGHTS; food safety and Health & Safety are CEILINGS" — and built the ceiling:
-- CAP_Gate at 49, applied with LEAST() AFTER the weighted sum, with a cap_reason beside
-- it. What that migration wired up were the check-sheet and H&S triggers. This adds the
-- third trigger the sentence always named and nothing yet fired on: an ACTION carrying
-- a food safety label.
--
-- Nothing here creates a fourth weight, and nothing may. A weight would price a failed
-- CCP at some number of points and let a good volume week buy it back. A ceiling can
-- only ever lower, so no arithmetic anywhere can turn a failed CCP into a good period.
--
-- THE GATE IS NOT ATTRIBUTION. An action whose labels are "not the leader's" still
-- gates, and this is deliberate rather than overlooked: the gate records that the event
-- OCCURRED in the period, not who is to blame for it. It is the same rule the H&S gate
-- already runs on — computeLeaderScore's `gating` filter applies no attribution either —
-- and the same reason a completed CAPA does not erase it. Only a REJECTED action is
-- void, because Quality looked and said it did not happen.

-- =====================================================================
-- 1. The flag
--
-- Mirrors quality_options_only_labels_are_priced from 20260815120000: a department is
-- not a label and cannot gate anything, and that belongs where it cannot be bypassed by
-- whoever writes the next screen.
-- =====================================================================

ALTER TABLE public.quality_options
  ADD COLUMN IF NOT EXISTS is_gate boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.quality_options
    ADD CONSTRAINT quality_options_only_labels_gate
    CHECK (kind = 'label' OR is_gate = false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.quality_options.is_gate IS
  'Uma accao com esta etiqueta forca RED e limita o score a CAP_Gate no periodo em que ocorreu. NAO e um peso e nao e compensavel. Nao e apagada por CAPA concluida — a CAPA fecha-se noutro sitio.';

-- =====================================================================
-- 2. Marking the four
--
-- Matched by NAME, lowercased and trimmed, because these labels were created through
-- the UI and exist in no migration — there is no id to target and no seed to amend.
--
-- Which means the match can silently hit nothing. A label spelled 'CCP' where this
-- expects 'Fail CCP' would leave the gate switched off on the exact deviation it was
-- built for, and the migration would report success. So it counts what it marked and
-- RAISES when the count is short: zero rows updated is a wrong work order, not a
-- completed one.
--
-- It does NOT create the missing labels. Inventing a food safety category because a
-- string did not match would put a label on the picker that nobody in the plant chose.
-- =====================================================================

DO $gates$
DECLARE
  _wanted constant text[] := ARRAY[
    'fail ccp', 'foreign body', 'wrong weight volume check', 'bag inside blender'];
  _found  text[];
  _absent text[];
BEGIN
  UPDATE public.quality_options
     SET is_gate = true
   WHERE kind = 'label'
     AND lower(btrim(value)) = ANY(_wanted)
     AND is_gate = false;

  SELECT coalesce(array_agg(DISTINCT lower(btrim(value))), ARRAY[]::text[]) INTO _found
    FROM public.quality_options
   WHERE kind = 'label' AND is_gate = true;

  SELECT coalesce(array_agg(w), ARRAY[]::text[]) INTO _absent
    FROM unnest(_wanted) AS w WHERE NOT (w = ANY(_found));

  RAISE NOTICE 'Etiquetas com gate activo: %', array_to_string(_found, ', ');

  IF cardinality(_absent) > 0 THEN
    RAISE EXCEPTION
      'Estas etiquetas de gate nao existem em quality_options: %. '
      'Nao foram criadas de proposito — inventar uma categoria de seguranca alimentar '
      'porque uma string nao bateu poria no picker uma etiqueta que ninguem na fabrica '
      'escolheu. Confirmar a grafia exacta com: SELECT value FROM quality_options WHERE '
      'kind = ''label'' ORDER BY value; e corrigir a lista desta migracao ou o nome da '
      'etiqueta. Um gate que nao dispara e pior do que gate nenhum.',
      array_to_string(_absent, ', ')
      USING ERRCODE = 'no_data_found';
  END IF;
END $gates$;

-- =====================================================================
-- 3. The ceiling itself is already seeded
--
-- CAP_Gate = 49 exists since 20260818090000 and is shared with the check-sheet and H&S
-- triggers on purpose: one number for "a gate fired", so a failed CCP and a lost-time
-- injury cannot come to disagree about what a gate costs. There is deliberately no
-- CAP_FoodSafety.
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leader_scorecard_threshold
                  WHERE name = 'CAP_Gate' AND valid_to IS NULL) THEN
    RAISE EXCEPTION
      'CAP_Gate nao tem versao vigente. 20260818090000 nao foi aplicada, e sem o tecto '
      'esta migracao marca etiquetas que nada limita.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END $$;
