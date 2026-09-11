-- =====================================================================
-- A root cause nobody writes, and that changed no number when they did
-- =====================================================================
--
-- 20260911075414 added `quality_actions.root_cause_area` so that a machine fault would
-- stop charging the shift leader through a side door — `Batch code` + `Maintenance`
-- charging 5 because the label rule needs only ONE attributable label. The reasoning
-- there still stands and none of it is reopened here.
--
-- It did not work. Two independent reasons, both found on 2026-09-11 by reading the
-- live base rather than the repo:
--
--   1. THE COLUMN WAS EMPTY. 0 of 182 rows carried a root cause. 84 of those actions
--      arrive from the SafetyCulture sync, which never writes the field (it does not
--      write `department` either, which is why the department veto of 20260827093000
--      has never fired on a synced row). The field could only be filled by a person
--      opening one action at a time, and no person did.
--
--   2. FILLING IT IN CHANGED NOTHING. `trg_quality_action_freeze_points_upd` re-prices
--      an action when one of the inputs to the price changes, and its WHEN clause named
--      severity, labels, validation_status and domain — but NOT root_cause_area. So
--      Quality could set the root cause, the value was stored, the history recorded it,
--      and `points_at_creation` — the only figure a scorecard reads — stayed exactly
--      where it was. The instruction "open the action and mark the root cause" could not
--      have worked for anybody who followed it.
--
-- The second is the worse of the two, because it fails in the direction that looks like
-- success: the field saves, the screen's LIVE preview recomputes and shows 0, and the
-- frozen number behind the card still says 5. Two numbers for one action, which is the
-- exact failure the freezing mechanism exists to prevent.
--
-- What this migration does NOT change: the label rule (`countsAgainstLeader`) is not
-- flipped to a veto. That lever was removed on purpose in `cd417686` and the note above
-- it explains why at length — a label lives in a SET, and anyone who worked out that
-- adding "Maintenance" to a genuine paperwork error cleared it would have an amnesty
-- nobody audits. The root cause is the instrument that closes the same door while
-- staying auditable: exactly one per action, its own column, its own history row with a
-- name and a time, and writable only by Quality (trg_a_quality_root_cause_guard).
--
-- And NOT the gate. `Foreign Body` + `Maintenance` now charges 0 points and still caps
-- the period at CAP_Gate, because the gate is computed over the LABELS — in
-- `scorecard_*` and in computeLeaderScore (src/lib/leaderScore.ts, the gateLabels test
-- on `a.labels`) — and never over `action_points_at`. A 0 returned there cannot silence
-- one. That is what BRC requires: a foreign body counts on the line it happened on,
-- whoever was at fault.

-- =====================================================================
-- 1. The re-pricing trigger learns about the field
-- =====================================================================
--
-- One line — `root_cause_area` — and without it nothing else in this file matters.

DROP TRIGGER IF EXISTS trg_quality_action_freeze_points_upd ON public.quality_actions;

CREATE TRIGGER trg_quality_action_freeze_points_upd
BEFORE UPDATE ON public.quality_actions
FOR EACH ROW
WHEN (
  old.severity          IS DISTINCT FROM new.severity
  OR old.labels            IS DISTINCT FROM new.labels
  OR old.validation_status IS DISTINCT FROM new.validation_status
  OR old.domain            IS DISTINCT FROM new.domain
  OR old.root_cause_area   IS DISTINCT FROM new.root_cause_area
)
EXECUTE FUNCTION public.quality_action_freeze_points();

COMMENT ON TRIGGER trg_quality_action_freeze_points_upd ON public.quality_actions IS
  'Recongela points_at_creation quando muda um input do preco. root_cause_area faltava '
  'aqui: a causa raiz gravava-se e o numero ficava o mesmo, por isso marcar Maintenance '
  'numa accao nao mudava cartao nenhum.';

-- =====================================================================
-- 2. The Maintenance label declares the root cause instead of hinting at it
-- =====================================================================
--
-- A default, not an override, and the difference is the whole design. The label says
-- "a machine is involved"; the factory has decided that when nobody says otherwise,
-- a machine being involved means the machine is the cause. Quality disagreeing is the
-- case this must not break, so an explicit value — including an explicit `Production`
-- that puts the charge back — always wins and is never touched here.
--
-- In a trigger rather than in the sync edge function or the log form, because there are
-- four writers to this table (the form, the SafetyCulture sync, the importer, and SQL
-- run by hand) and a rule placed in one of them is a rule the other three do not have.
--
-- The `_b_` in the name is load-bearing. Trigger order is alphabetical, and this must
-- run:
--   * AFTER trg_a_quality_root_cause_guard — that guard raises 42501 when somebody
--     without `quality.validate`/`quality.manage` sets a root cause. Firing first would
--     mean a line leader logging a machine fault got "Only Quality may set the root
--     cause of an action." thrown in their face for ticking a label.
--   * BEFORE trg_quality_action_freeze_points_* — which is what actually re-prices, and
--     reads NEW as the BEFORE triggers have left it.

CREATE OR REPLACE FUNCTION public.default_root_cause_from_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- So preenche o vazio. Uma causa raiz escrita pela Qualidade manda sempre: quem
  -- disser que a culpa foi da Producao num equipamento avariado tem de continuar a
  -- ver os pontos a voltar.
  IF NEW.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(NEW.labels, ARRAY[]::text[])) AS l
     WHERE lower(btrim(l)) = 'maintenance'
  ) THEN
    NEW.root_cause_area := 'Maintenance';
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.default_root_cause_from_label() IS
  'O rotulo Maintenance passa a declarar a causa raiz em vez de a insinuar. O nome do '
  'gatilho comeca por _b_ de proposito: tem de correr DEPOIS do '
  'trg_a_quality_root_cause_guard (senao um lider que registe uma avaria levava com o '
  'erro "Only Quality may set the root cause") e ANTES do '
  'trg_quality_action_freeze_points_upd, que e quem repreca a accao.';

DROP TRIGGER IF EXISTS trg_b_quality_root_cause_default ON public.quality_actions;

CREATE TRIGGER trg_b_quality_root_cause_default
BEFORE INSERT OR UPDATE ON public.quality_actions
FOR EACH ROW
EXECUTE FUNCTION public.default_root_cause_from_label();

-- =====================================================================
-- 3. The 47 rows that were already logged
-- =====================================================================
--
-- 20260911075414 deliberately back-filled nothing — "every row that exists today keeps
-- exactly the score it has today". That was the right call for a field whose meaning
-- was still being decided; it is the wrong one now that the rule is settled and the
-- consequence of leaving it is known. What was left standing, read off the live base:
--
--   23 actions carrying `Maintenance` alongside a priced label, charging 100 points,
--   51 of them to a named leader. Henrique 11, Ailton 10, and 5 each to Kaz, Kleyve,
--   Lucas, Nilton and Everton for, among others:
--
--     "The ceiling in the women's restroom requires repair"          GMP  5
--     "The floor needs to be repaired (canteen upstairs)"            GMP  5
--     "Laboratory Air Conditioner Leaking"                           GMP  5
--     "The table in line 1 needs to be repaired or replaced"         GMP  5
--     "Filling line 3 needs to be painted"                           GMP  5
--
-- A leader losing five quality points because a canteen ceiling needs plastering is not
-- a rounding error in an appraisal, it is the appraisal being wrong.
--
-- Scoped to the label, and to rows where nobody has said anything: `root_cause_area IS
-- NULL` means the question was never answered, and only that. A row somebody HAS
-- answered is left exactly as they answered it. The UPDATE re-fires the trigger above,
-- which re-prices each row against `scoring_version_id` as it already stands — so v1
-- rows are re-priced on v1's scale, v2 on v2's, and no action is quietly dragged onto
-- today's ruler. Idempotent: on a base where this has run, it matches no rows.

UPDATE public.quality_actions
   SET root_cause_area = 'Maintenance'
 WHERE root_cause_area IS NULL
   AND EXISTS (
     SELECT 1 FROM unnest(coalesce(labels, ARRAY[]::text[])) AS l
      WHERE lower(btrim(l)) = 'maintenance'
   );
