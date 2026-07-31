-- One name for the gel line, as with the tablet line.
--
-- Four spellings for one line: "GEL Machine" in the lines table and in 7 sessions,
-- 3 RAG rows and 1 downtime; "Gel Line" in 4 sessions, 6 RAG rows and 3 downtimes;
-- "GEL Line" in iTouching. Anything grouped by name counted the same line twice.
--
-- Unified on the iTouching spelling for the same reason as before: their machine map
-- has to match what their API returns, so ours is the side that moves.
UPDATE public.lines                SET name         = 'GEL Line' WHERE name         IN ('GEL Machine', 'Gel Line');
UPDATE public.production_sessions  SET line         = 'GEL Line' WHERE line         IN ('GEL Machine', 'Gel Line');
UPDATE public.rag_weekly_entries   SET line         = 'GEL Line' WHERE line         IN ('GEL Machine', 'Gel Line');
UPDATE public.quality_actions      SET line         = 'GEL Line' WHERE line         IN ('GEL Machine', 'Gel Line');
UPDATE public.work_orders          SET line_at_time = 'GEL Line' WHERE line_at_time IN ('GEL Machine', 'Gel Line');
UPDATE public.production_downtimes SET line         = 'GEL Line' WHERE line         IN ('GEL Machine', 'Gel Line');

-- "GEL PACKING" — one production session — is deliberately NOT folded in. iTouching
-- carries "Gel Packing" as a machine of its own, separate from "GEL Line", so that row
-- may be a machine rather than the line. Merging them would quietly move a shift's
-- output from one place to another, and one row is not worth guessing over.
