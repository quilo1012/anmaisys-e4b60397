-- One name for the tablet line.
--
-- The same physical line was called "Capsules & Tablets" by the lines table, the
-- production sessions, the RAG plan, the quality actions and the work orders, and
-- "Tablet Line" by iTouching. Production Control read from more than one of those, so
-- the same line appeared more than once in its filters — and a report grouped by name
-- split one line's output in two.
--
-- Renamed to the iTouching name, because that is the one nobody here controls: the
-- machine map has to match what their API returns, so ours is the side that moves.
--
-- Text columns, not foreign keys: `lines.id` is unaffected and nothing is re-pointed.
-- Row counts before the change — lines 1, sessions 30, RAG 40, quality 1, work orders
-- 12, downtimes 4.
UPDATE public.lines               SET name         = 'Tablet Line' WHERE name         = 'Capsules & Tablets';
UPDATE public.production_sessions SET line         = 'Tablet Line' WHERE line         = 'Capsules & Tablets';
UPDATE public.rag_weekly_entries  SET line         = 'Tablet Line' WHERE line         = 'Capsules & Tablets';
UPDATE public.quality_actions     SET line         = 'Tablet Line' WHERE line         = 'Capsules & Tablets';
UPDATE public.work_orders         SET line_at_time = 'Tablet Line' WHERE line_at_time = 'Capsules & Tablets';
UPDATE public.production_downtimes SET line        = 'Tablet Line' WHERE line         = 'Capsules & Tablets';

-- Still inconsistent, and deliberately left alone until somebody decides the name:
-- the gel line is "GEL Machine" in lines, "Gel Line" in 4 sessions and 6 RAG rows,
-- "GEL PACKING" in 1 session, and "GEL Line" in iTouching. Same class of problem,
-- four spellings, and renaming what nobody asked for is how history gets rewritten
-- twice.
