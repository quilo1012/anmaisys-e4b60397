-- ================================================================
-- 09 — Paperwork label backfill, OPEN actions only (2026-09-09)
-- ================================================================
-- Adds the 'Paperwork' label to the nine SafetyCulture actions whose error_type names
-- a paperwork failure AND whose validation_status is neither 'validated' nor
-- 'rejected'. Labelling an unjudged action changes no computed figure: qualityScore
-- only hands a VALIDATED paperwork error to the documentation demerit, and the
-- Documentation pillar stays null while no verdict exists. Only the sentence the card
-- prints changes.
--
-- No 'validated' or 'rejected' action is touched — there were none among the
-- candidates on 09/09/2026, and this UPDATE guards against it anyway.
--
-- EXACT IDS CHANGED (undo: remove 'Paperwork' from labels for these ids):
--   2144c615-082e-467c-a632-c5d3c070d73f  Henrique      Line 6    Missing signature or time
--   2120b4ad-0486-431d-8493-1e680035a677  (no leader)   (no line) Check not recorded
--   c4167c0d-76fa-47b0-a96e-f616d59977c0  Guilherme     Line 2    Check not recorded
--   93e738af-895c-4d3a-b714-e8c09930d454  Cainan        Line 5    Missing check on spec
--   fe8863c1-b0af-49c6-9924-8b90b3b17323  Henrique      Line 2    Missing check on spec
--   4e8afbd8-91b5-4d0d-bbf6-1bace591824a  (no leader)   GEL Line  Missing signature or time
--   1a0ea807-3686-4eb8-a6f5-f3762fa199fc  (no leader)   GEL Line  Missing signature or time
--   8f8c480b-5be0-4cce-918a-0281a2994dcd  Everton       Line 5    Incomplete checklist
--   bb3c524e-e217-4a1b-abc1-b9b46e499824  Rafael Tosta  Line 4    Missing check on spec
--
-- UNDO:
--   UPDATE public.quality_actions
--      SET labels = array_remove(labels, 'Paperwork')
--    WHERE id IN ( ...the nine ids above... );
-- ================================================================

UPDATE public.quality_actions
   SET labels = array_append(coalesce(labels, '{}'::text[]), 'Paperwork')
 WHERE source = 'safetyculture'
   AND error_type IN ('Check not recorded', 'Incomplete checklist',
                      'Missing check on spec', 'Missing signature or time')
   AND coalesce(validation_status, 'open') NOT IN ('validated', 'rejected')
   AND NOT (coalesce(labels, '{}'::text[]) @> ARRAY['Paperwork']);
