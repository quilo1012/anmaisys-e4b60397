-- The weekly board had nothing to draw, so nobody could fill it in.
--
-- leader_weekly_scorecard holds zero rows. The screen was read as unused — a training
-- problem, or people not seeing the point. It is neither. scorecard_week_board(), from
-- 20260819090000, opens with FROM public.leader_line_assignment and joins line_leaders
-- and lines onto it. That table has never had a row, so the RPC returns nothing for
-- EVERY week, LeaderScorecardWeekPage renders an empty board, and there is no control
-- anywhere in the app that adds a line to it: nothing in src/ writes
-- leader_line_assignment. Twelve people hold the role that may fill a scorecard and not
-- one of them was ever shown a row to fill.
--
-- WHERE THESE SEVEN COME FROM, and what they are worth. They are not a declaration by
-- anyone. They were inferred from daily_allocations (is_leader) over the last weeks:
-- for each line_leaders row, the area that person led on most days. Only the seven who
-- appeared on exactly ONE area are here. Eleven more had a dominant area but rotated
-- across two to five — Juliano appeared on five — and a dominant area out of five is a
-- guess wearing a number. One, "Pedro", matches two different employees (Pedro Correia
-- and Pedro De Assis) and cannot be resolved from data at all. Eleven of the 29 never
-- appear on the board. All of those are deliberately absent: this seeds what is safe to
-- assert and leaves the rest to a person.
--
-- Matching had to be done on the FIRST NAME. line_leaders stores first names only —
-- "Alice", "Kaz" — because the one place that creates a leader is a free-text field in
-- IntouchImportDialog. employees stores full names. Comparing the whole string matches
-- two of 29, and only because those two happen to carry a surname. This is the same
-- missing-surname trap the TimeMoto import already hit.
--
-- Ids are written out rather than resolved by name at apply time. A name lookup inside
-- an INSERT is a silent no-op when the spelling drifts, and "thiago souza" is already
-- stored lowercase where the rest are not. Each id carries its name in a comment so a
-- reviewer can check the pair without a query. All seven were verified to resolve to
-- exactly one active line_leaders row and one lines row.
--
-- Line 5 gets TWO leaders (Everton and Vagner) and that is not a mistake: the table is
-- keyed on neither column alone and the board is one row per assignment, so a line with
-- two leaders appears twice. valid_from/valid_to exist so this can be corrected without
-- deleting history.
--
-- THIS IS DATA, NOT SCHEMA, and it is in a migration because ad-hoc DDL and DML against
-- this database is how two wrong views got created outside the ledger this week. A pair
-- that turns out wrong is corrected by closing it with valid_to, not by editing this
-- file. The durable fix is a screen for managing assignments, which does not exist yet.

INSERT INTO public.leader_line_assignment (leader_id, line_id, valid_from)
SELECT v.leader_id, v.line_id, DATE '2026-08-17'
FROM (VALUES
  ('e7792f1a-f375-4e16-94b7-3c4cf4da4789'::uuid,  -- Lucas
   '57756a3e-fe14-4b71-a18d-61054af9ee9a'::uuid), -- Line 1
  ('7e7f1558-d904-4280-ad9c-84a62e7a43f0'::uuid,  -- thiago souza
   'e4a17e5e-3923-460a-acfd-93e3b8a67e06'::uuid), -- Line 2
  ('857877f4-f4de-45f2-9052-e450ea25a553'::uuid,  -- Rafael Tosta
   '54c45628-40b9-40a8-84f8-ec9649e112b2'::uuid), -- Line 4
  ('de958b79-443a-4f8e-8184-b9af13449c00'::uuid,  -- Everton
   '113151ed-5fd9-4fc7-9fdd-a7c5a6fae5ba'::uuid), -- Line 5
  ('a6ce2f23-012e-46cd-ae17-35dd065df13c'::uuid,  -- Vagner
   '113151ed-5fd9-4fc7-9fdd-a7c5a6fae5ba'::uuid), -- Line 5
  ('466ca641-0c04-4226-9ddc-2d7404d27a3a'::uuid,  -- Ailton
   '85d20033-25ef-4b69-90fe-993f2e52ffd2'::uuid), -- Line 6
  ('f6c3d1d7-193c-46c9-a244-09d63ebbab24'::uuid,  -- Muriel
   'f5f8703e-a220-49d7-8c58-f0cb24d2be45'::uuid)  -- Tablet Line
) AS v(leader_id, line_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.leader_line_assignment a
   WHERE a.leader_id = v.leader_id AND a.line_id = v.line_id);

DO $$
DECLARE _n integer;
BEGIN
  SELECT count(*) INTO _n FROM public.leader_line_assignment;
  RAISE NOTICE 'leader_line_assignment tem % atribuicoes. O quadro semanal passa a ter linhas.', _n;
END $$;
