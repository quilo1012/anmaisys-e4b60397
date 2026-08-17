-- ================================================================
-- 20260820090000_filling_a_week_is_not_approving_it
-- ================================================================
-- Filling a week is not approving it.
--
-- `src/lib/permissions.ts` already draws the line: `scorecard.fill` includes
-- production_office_admin, `scorecard.approve` deliberately does not — approving a week
-- that carries a Fail is the control that stops an investigation being waived by the
-- very people who should be doing it. Below the UI that line did not exist.
--
-- Two holes, both in 20260815140000_health_and_safety_is_the_second_gate.sql, which this
-- migration does not edit — it replaces what it must and leaves the rest standing.
--
--  1. The policy "Management writes weekly scorecard" is FOR ALL and lists
--     production_office_admin among the writers. A role without scorecard.approve could
--     therefore write approved_by/approved_at itself: the screen simply does not show
--     the button, and the screen is not the enforcement. Anything that speaks PostgREST
--     — the next import script, the SQL editor, a curl with the anon key and a session —
--     goes straight round it.
--
--  2. The trigger scorecard_require_capa_before_approval demanded only that approved_by
--     be NOT NULL. It never asked whether that uuid is the person actually writing, so
--     any writer could sign somebody else's name to an approval, and never asked whether
--     that person may approve at all. "Nothing may be self-declared without a trace"
--     was half-built: there was a name, but nothing tied the name to the act.
--
-- The split enforced here is the one the permission matrix already states:
--
--   fill    = admin, manager, quality_supervisor, production_office_admin
--   approve = admin, manager, quality_supervisor
--
-- and an approval must additionally be SIGNED BY THE CALLER: NEW.approved_by = auth.uid().
-- Two independent gates on purpose. RLS stops the row from carrying an approval at all
-- when the writer may not approve; the trigger stops an approver from signing a name
-- that is not theirs. Neither can be reached round the other, and the CAPA rule that was
-- already there is preserved verbatim — this adds to it, it does not replace it.
--
-- Safe on a database that has never seen this module: everything below is guarded, and
-- the one hard failure is the deliberate one — if leader_weekly_scorecard is absent, the
-- migration says which file to run first instead of half-applying.

-- =====================================================================
-- 0. Refuse to run out of order rather than leave the table half-governed
-- =====================================================================

DO $$ BEGIN
  IF to_regclass('public.leader_weekly_scorecard') IS NULL THEN
    RAISE EXCEPTION
      'public.leader_weekly_scorecard nao existe. Aplique primeiro 20260815140000_health_and_safety_is_the_second_gate.sql (ver docs/scorecard-v2-apply.md).';
  END IF;
  IF to_regproc('public.has_role') IS NULL THEN
    RAISE EXCEPTION 'public.has_role nao existe: esta base nao tem o modelo de papeis que estas politicas usam.';
  END IF;
END $$;

-- =====================================================================
-- 1. RLS: production_office_admin fills, and cannot approve
--
-- FOR ALL becomes one policy per verb, because the rule is not the same for all of
-- them. The predicate repeated below is deliberately written out rather than hidden in
-- a helper function: a policy that has to be read to be trusted should not send the
-- reader somewhere else, and the same two lists already appear spelled out in the
-- migration this one amends.
--
-- The rule is a single sentence in three places: whoever may fill may write the row,
-- but a row that CARRIES an approval (approved_at IS NOT NULL) may only be written by
-- whoever may approve. The approval_pair CHECK from 20260815140000 already ties
-- approved_at and approved_by together, so testing approved_at tests both.
--
-- One consequence, stated rather than discovered: an already-approved week can no
-- longer be edited by production_office_admin at all. That is the intended reading of a
-- signed record. A correction to an approved week goes through somebody who could have
-- approved it.
--
-- For UPDATE that sentence needs the predicate TWICE, on the OLD row and on the NEW one,
-- and the first version of this migration only had it on the NEW one. WITH CHECK alone
-- says "you may not leave an approval behind" — it says nothing about what you were
-- allowed to pick up. So `UPDATE … SET approved_at = NULL, approved_by = NULL` sailed
-- through: USING saw only the role, WITH CHECK saw approved_at IS NULL and was content,
-- and the trigger returns early on a NULL approved_at. A filler could un-sign a week,
-- edit it freely, and the record of who had signed it was gone. Repeating the conjunct in
-- USING is what makes the paragraph above true instead of merely intended: the OLD row
-- must be unsigned, or the writer must be somebody who could have signed it.
--
-- The SELECT policy from 20260815140000 ("Signed in reads weekly scorecard") is left
-- exactly as it is: the card is discussed with the leader it is about, and reading was
-- never the problem.
-- =====================================================================

DROP POLICY IF EXISTS "Management writes weekly scorecard" ON public.leader_weekly_scorecard;

DROP POLICY IF EXISTS "Management fills weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Management fills weekly scorecard"
  ON public.leader_weekly_scorecard FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
      OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    )
    AND (
      approved_at IS NULL
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    ));

DROP POLICY IF EXISTS "Management updates weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Management updates weekly scorecard"
  ON public.leader_weekly_scorecard FOR UPDATE TO authenticated
  -- USING reads the row as it stands. A signed week is only writable by somebody who
  -- could have signed it — otherwise un-approving is the way round every line below.
  USING (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
      OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    )
    AND (
      approved_at IS NULL
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    ))
  -- WITH CHECK reads the row being left behind: a filler may write the week, but may not
  -- leave an approval on it.
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
      OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    )
    AND (
      approved_at IS NULL
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    ));

-- DELETE existed under the old FOR ALL and is kept, with the same asymmetry: a week
-- nobody signed may be removed by whoever could have filled it, but deleting a SIGNED
-- week destroys the signature, and that is an approver's act — otherwise "delete and
-- re-insert" would be a way round every line above.
DROP POLICY IF EXISTS "Management deletes weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Management deletes weekly scorecard"
  ON public.leader_weekly_scorecard FOR DELETE TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
      OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    )
    AND (
      approved_at IS NULL
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    ));

-- =====================================================================
-- 2. The trigger: an approval is signed by the person making it
--
-- The CAPA gate below is 20260815140000's, character for character, and runs first for
-- the same reason it always did. What follows it is new.
--
-- The signature is only demanded when the approval is actually being made or changed —
-- an INSERT that arrives approved, or an UPDATE that writes a different approver or a
-- different moment. Editing something else on an already-approved week (fixing the
-- wording of a corrective action, say) does not ask the editor to re-sign as the
-- original approver, which they are not. RLS above already decides whether they may
-- touch a signed row at all.
--
-- auth.uid() is NULL outside a user session (psql, service_role, a migration). Under
-- this rule such a session cannot approve a week — deliberately: an approval with no
-- authenticated person behind it is exactly the self-declared stamp this closes. A
-- backfill of historical approvals, if one is ever needed, is a documented one-off that
-- disables this trigger explicitly and says so, not a hole left open for it.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scorecard_require_capa_before_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  _fail_type text;
  _approval_changed boolean;
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  _fail_type := public.scorecard_quality_fail_type(
    ARRAY[NEW.ccp_check_status, NEW.starter_check_status, NEW.volume_weight_check_status]);

  IF _fail_type = 'Fail'
     AND (nullif(btrim(coalesce(NEW.root_cause, '')), '')        IS NULL
       OR nullif(btrim(coalesce(NEW.corrective_action, '')), '') IS NULL
       OR nullif(btrim(coalesce(NEW.capa_owner, '')), '')        IS NULL
       OR NEW.capa_due_date IS NULL) THEN
    RAISE EXCEPTION
      'Semana com check reprovado (Fail) nao pode ser aprovada sem CAPA: root_cause, corrective_action, capa_owner e capa_due_date sao obrigatorios.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An approval names somebody. An unsigned approval is not a trail.
  IF NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'Aprovacao exige approved_by.' USING ERRCODE = 'check_violation';
  END IF;

  _approval_changed := TG_OP = 'INSERT'
    OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
    OR OLD.approved_at IS DISTINCT FROM NEW.approved_at;

  IF _approval_changed THEN
    -- ...and the somebody it names is the person doing it. Otherwise any writer
    -- could sign an approval in a colleague's name.
    IF NEW.approved_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'Aprovacao tem de ser assinada por quem a faz: approved_by tem de ser o utilizador autenticado.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- ...and that person holds a role that may approve. Preencher e aprovar sao
    -- permissoes diferentes (scorecard.fill vs scorecard.approve): production_office_admin
    -- preenche a semana e nao a assina.
    IF NOT (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    ) THEN
      RAISE EXCEPTION
        'Sem permissao para aprovar uma semana: e preciso admin, manager ou quality_supervisor.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Recreated rather than assumed: the trigger is dropped and re-added so this file also
-- works on a database where 20260815140000 ran before the trigger existed in this shape.
DROP TRIGGER IF EXISTS trg_scorecard_require_capa ON public.leader_weekly_scorecard;
CREATE TRIGGER trg_scorecard_require_capa
  BEFORE INSERT OR UPDATE ON public.leader_weekly_scorecard
  FOR EACH ROW EXECUTE FUNCTION public.scorecard_require_capa_before_approval();
