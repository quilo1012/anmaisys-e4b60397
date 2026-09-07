-- Fourteen of the twenty-two imported actions carried the wrong leader's name.
--
-- Reported from the floor: the Line 4 actions of 06/09 came out as Rafael Tosta, and
-- Line 4 that morning was Marcio. It is not a data-entry slip. `leader_line_assignment`
-- holds SEVEN rows and every one of them is open ended — "Rafael Tosta has Line 4 from
-- 2026-08-17, no end date" — so every action on a line came out in one name whatever
-- the day and whatever the shift. Twenty-four of the thirty-one active leaders have no
-- assignment at all; Marcio is one of them.
--
-- Measured on 07/09/2026 against `production_sessions`, which is written when somebody
-- opens the line and records the line, the date, the shift and who opened it:
--
--   478b58c4  Line 4  06/09 09:23  Rafael Tosta -> Marcio
--   53949fc3  Line 4  06/09 07:19  Rafael Tosta -> Marcio
--   2cc27aaf  Line 5  04/09 08:48  Vagner       -> Everton
--   b3e8e0c5  Line 2  03/09 23:21  thiago souza -> Henrique
--   fbc300af  Line 5  03/09 19:12  Vagner       -> Cainan
--   b957de80  Line 2  03/09 06:03  thiago souza -> Guilherme
--   c561947a  Line 4  03/09 02:23  Rafael Tosta -> Filipi
--   2f47bcac  Line 3  02/09 18:05  (nenhum)     -> Kleyve
--   31419910  Line 1  02/09 02:53  Lucas        -> Kaz
--   2e8e2f82  Line 6  02/09 02:46  Ailton       -> Henrique
--   b74e5b26  Line 6  02/09 02:39  Ailton       -> Henrique
--   47945bfa  Line 4  01/09 21:19  Rafael Tosta -> Filipi
--   dc9caca7  Line 6  01/09 21:13  Ailton       -> Henrique
--   2b12cb62  Line 2  01/09 15:06  thiago souza -> Guilherme
--
-- Five of those are past midnight. The night shift opens around 17:00 and runs into
-- the next date, so the session that owns an action raised at 02:23 on the 3rd is the
-- one opened at 17:09 on the 2nd. Matching on the calendar date of the action finds
-- nothing for them — and "nothing" was precisely when the standing assignment stepped
-- in and named the day-shift leader instead.
--
-- The permanent fix is in `_shared/safetyculture/leaderOnDuty.ts`, which every future
-- import and re-classification goes through. This is the one-off repair of what is
-- already stored, written the same way: the last session opened on that line at or
-- before the finding, and no more than sixteen hours before it.

-- Sixteen hours, not twelve: `finished_at` is null on every row in
-- `production_sessions`, so nothing records when a shift ended and the window has to
-- stand in for it. Sixteen leaves room for an overrun without letting last night's
-- shift claim this morning's finding.
WITH in_charge AS (
  SELECT qa.id,
         s.leader_name AS session_leader
  FROM public.quality_actions qa
  CROSS JOIN LATERAL (
    SELECT ps.leader_name
    FROM public.production_sessions ps
    WHERE ps.line = qa.line
      AND ps.started_at <= qa.recorded_at
      AND ps.started_at > qa.recorded_at - interval '16 hours'
    ORDER BY ps.started_at DESC
    LIMIT 1
  ) s
  WHERE qa.source = 'safetyculture'
    AND qa.line IS NOT NULL
),
resolved AS (
  -- The session names the leader and nothing else; `production_sessions.leader_id` is
  -- null on every row. Resolve it the way the rest of this schema does: fold the name
  -- and accept it only when exactly ONE leader answers to it. Two rules for one
  -- question would drift, and the drift would be silent.
  SELECT c.id,
         c.session_leader,
         -- Accepted only when exactly ONE leader answers to the name: a name two
         -- people share identifies neither. (No min(uuid) in Postgres, so the
         -- uniqueness is asserted with a count rather than an aggregate.)
         (SELECT ll.id FROM public.line_leaders ll
           WHERE lower(btrim(ll.name)) = lower(btrim(c.session_leader))
             AND (SELECT count(*) FROM public.line_leaders l2
                   WHERE lower(btrim(l2.name)) = lower(btrim(c.session_leader))) = 1
           LIMIT 1) AS leader_id
  FROM in_charge c
  WHERE c.session_leader IS NOT NULL
)
UPDATE public.quality_actions qa
SET leader_name = r.session_leader,
    leader_id = r.leader_id
FROM resolved r
WHERE qa.id = r.id
  AND qa.leader_name IS DISTINCT FROM r.session_leader;

-- Anything the sessions could not speak for keeps whatever it had; it is not silently
-- blanked. The re-classification pass is what decides whether it can stand, and it now
-- reads the sessions too.
