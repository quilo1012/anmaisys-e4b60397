-- A line leader is not an account, and this column has claimed otherwise since June.
--
-- `quality_actions.leader_id` was created on 24/06 as
--   ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES auth.users(id)
-- in the same statement block that gave `production_sessions` the identical column.
-- Line leaders have no accounts — their PIN is a second factor over somebody else's
-- session, not a login — so no id the log form can offer has ever existed in
-- `auth.users`, and every save naming a leader is rejected with
--   insert or update on table "quality_actions" violates foreign key constraint
--   "quality_actions_leader_id_fkey"
--
-- `production_sessions` was repointed at `line_leaders` on 27/06 (20260627090632).
-- `quality_actions` was not included in that fix and kept the wrong parent.
--
-- Why it only started failing now: nothing wrote the column. The log form carried
-- `leader_name` and left the id null, and a null passes a foreign key untested. The
-- H&S work of 15–17/08 made the id load-bearing — `scorecard_safety_counts` counts
-- `WHERE leader_id = _leader_id`, because counting a leader by name is the fragility
-- this schema has been walking away from — so the form began sending it, and the
-- constraint has rejected those saves ever since.

-- ---------------------------------------------------------------------
-- 1. Drop the key by what it CONSTRAINS, not by what it is called
-- ---------------------------------------------------------------------
-- Same catalogue lookup 20260627090632 used on the sibling table. The name in the
-- error message is the default one, but a key that was ever dropped and re-added by
-- hand carries a different name, and `DROP CONSTRAINT IF EXISTS <guess>` would then
-- succeed at removing nothing and leave the ADD below to fail.
DO $$
DECLARE
  _constraint_name text;
BEGIN
  SELECT conname INTO _constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.quality_actions'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                        WHERE attrelid = 'public.quality_actions'::regclass
                          AND attname = 'leader_id')]
  LIMIT 1;

  IF _constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quality_actions DROP CONSTRAINT %I', _constraint_name);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Rehome the ids that are already stored
-- ---------------------------------------------------------------------
-- Every non-null `leader_id` in the table today satisfies the OLD key, which means it
-- is an `auth.users` id and therefore not a `line_leaders` id. Left alone, all of them
-- would be rejected by the new key and this migration would fail on step 3.
--
-- They are not discarded blindly: the row also carries `leader_name`, so where that
-- name identifies exactly ONE line leader the id is rewritten to point at them, and
-- the attribution the row was always trying to record survives. Matching is on
-- upper(trim()) because the two tables disagree about case — `line_leaders` holds
-- names in capitals, production screens write them in title case.
--
-- Exactly one, or nothing. Two leaders sharing a name is a real possibility here and a
-- coin-flip between them would silently move somebody's score onto a colleague's card;
-- a null says "unattributed", which is true, and `leader_name` still prints.
UPDATE public.quality_actions AS qa
   SET leader_id = ll.id
  FROM public.line_leaders AS ll
 WHERE qa.leader_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.line_leaders x WHERE x.id = qa.leader_id)
   AND upper(btrim(qa.leader_name)) = upper(btrim(ll.name))
   AND (SELECT count(*) FROM public.line_leaders y
         WHERE upper(btrim(y.name)) = upper(btrim(qa.leader_name))) = 1;

UPDATE public.quality_actions AS qa
   SET leader_id = NULL
 WHERE qa.leader_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.line_leaders x WHERE x.id = qa.leader_id);

-- ---------------------------------------------------------------------
-- 3. Point it at the table the application has been sending ids from
-- ---------------------------------------------------------------------
-- ON DELETE RESTRICT, where the sibling `production_sessions` chose SET NULL. These
-- rows are scored: `scorecard_safety_counts` and the weekly card read the leader off
-- this column, so a SET NULL would quietly detach past occurrences from the leader
-- they belonged to and every historical score containing them would shift. RESTRICT
-- matches `leader_line_assignment` and `leader_weekly_scorecard`, which hold the same
-- kind of record. It costs nothing operationally: a leader who stops leading is marked
-- `active = false` — which is what the pickers filter on — and is not deleted.
ALTER TABLE public.quality_actions
  ADD CONSTRAINT quality_actions_leader_id_fkey
  FOREIGN KEY (leader_id) REFERENCES public.line_leaders(id) ON DELETE RESTRICT;
