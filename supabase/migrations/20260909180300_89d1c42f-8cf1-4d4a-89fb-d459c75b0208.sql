-- The Documentation pillar only scores an action carrying the "Paperwork" label
-- (DOCUMENTATION_LABEL in src/lib/qualityConstants.ts). Four ACTIVE rules already
-- name a paperwork failure in their error_type but carried no label, so every action
-- they matched arrived unlabelled and the pillar had nothing to judge.
--
-- Rules touched (all active, priority 40, match_field = title):
--   Check not recorded
--   Incomplete checklist
--   Missing check on spec
--   Missing signature or time
--
-- Only the label is set. No severity, error_type, department or domain changes, no new
-- rule is created, and no existing quality_actions row is backfilled: future imports only.

UPDATE public.sc_classification_rules
SET label = 'Paperwork'
WHERE active
  AND coalesce(trim(label), '') = ''
  AND error_type IN (
    'Check not recorded',
    'Incomplete checklist',
    'Missing check on spec',
    'Missing signature or time'
  );