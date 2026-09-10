-- ================================================================
-- 09 — Paperwork label backfill, OPEN actions only (2026-09-09)
-- ================================================================
-- Adds the 'Paperwork' label to the nine SafetyCulture actions whose error_type names
-- a paperwork failure AND whose validation_status is neither 'validated' nor
-- 'rejected'.
--
-- CORRECTION (10/09/2026). This header claimed "labelling an unjudged action changes
-- no computed figure ... the Documentation pillar stays null while no verdict exists.
-- Only the sentence the card prints changes."
--
-- THE SECOND HALF OF THAT IS WRONG, AND ONE LEADER'S CARD MOVED BECAUSE OF IT.
--
-- The Documentation pillar is null only when `pendingPaperwork > 0`. Read
-- `computeLeaderScore`: the null branch is `validatedPaperwork === 0 && pendingPaperwork
-- > 0`. A leader with NO paperwork action pending at all falls through to
-- `documentationScore(0)`, which is 100 — full marks. So labelling a leader's FIRST
-- paperwork action flips their Documentation from 100 to null, the pillar drops out,
-- and its 40% is shared among the others. The final score changes.
--
-- "No verdict exists" and "the pillar is null" are not the same statement, and the
-- distance between them is exactly one leader:
--
--   Cainan, Guilherme, Henrique, Rafael Tosta — each already had a pending paperwork
--   action before this ran, so their Documentation was ALREADY null. Unchanged, as
--   claimed.
--
--   Everton had none. His Documentation was 100 and is now null. Measured against the
--   live rows: production 100% over the last 30 days and 88.7% over the full history,
--   quality 87.
--       last 30 days   (100·10 + 87·50 + 100·40)/100 = 93  ->  (100·10 + 87·50)/60 = 89
--       full history   ( 88.7·10 + 87·50 + 100·40)/100 = 92  ->  (887 + 4350)/60    = 87
--   His card fell 4 to 5 points.
--
-- The FALL IS CORRECT and this backfill should not be reverted for it: he was being
-- handed 40% of his score for a judgement nobody had made, and now he is not. What was
-- wrong was reporting that nothing moved. Anyone reading a leader's score down by five
-- points deserves the sentence that explains it, and this file is where that sentence
-- has to live.
--
-- The claim about `qualityScore` IS right: only a VALIDATED paperwork error moves to the
-- documentation demerit, so the quality pillar is untouched, and `points_at_creation` is
-- frozen on all nine, so no charge moved either.
--
-- No 'validated' or 'rejected' action is touched — there were none among the
-- candidates on 09/09/2026, and this UPDATE guards against it anyway. That guard is what
-- kept the damage to one pillar on one card instead of rewriting signed figures.
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
