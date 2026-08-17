-- ================================================================
-- 20260816090000_the_screen_asks_the_database
-- ================================================================
-- The screen asks the database.
--
-- Two functions and one column, so that the write screen can show what it must without
-- deciding anything. scorecard_week_board answers "who is expected this week, and where
-- did each of them get to" — the question a GROUP BY over the weeks cannot answer,
-- because a leader who recorded nothing has no row to group. scorecard_derived_volume
-- answers "what does production already say about this line this week", so the same
-- number is not typed twice into two modules that will then disagree.
--
-- COLUMN-NAME CORRECTION from the brief: the brief assumed rag_weekly_entries carries
-- line_id (uuid) and that a separate `downtime` table (line_id, occurred_on, minutes)
-- holds the unplanned-downtime figure. Neither is true of the live schema:
--   * rag_weekly_entries has no line_id at all — it keys production by `line` (free
--     text), matched to public.lines.name elsewhere in this codebase with a
--     case/spacing-insensitive compare (see rag_actual_from_floor, migration
--     20260730100000). scorecard_derived_volume follows that same precedent rather
--     than an exact-text join, because the two spellings are known to still drift for
--     at least one line (see the note at the end of migration
--     20260801080000_one_name_for_the_tablet_line.sql).
--   * public.downtime is a real, unrelated table (line TEXT, started_at/ended_at,
--     no line_id, no minutes, no occurred_on) — a leftover of an earlier module, not
--     the source for this figure.
--   * The unplanned-downtime minutes for a line/week are not in a separate table at
--     all: rag_weekly_entries already carries them, per entry, as `downtime_min`
--     (added in migration 20260627071614). So scorecard_derived_volume needs only one
--     table, not a join to a second one — and every output column below has a real
--     source, so nothing here returns a NULL for a column that could have been
--     computed.

DO $$ BEGIN
  CREATE TYPE public.scorecard_volume_source AS ENUM ('derivado', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.leader_weekly_scorecard
  ADD COLUMN IF NOT EXISTS volume_source public.scorecard_volume_source;

COMMENT ON COLUMN public.leader_weekly_scorecard.volume_source IS
  'De onde veio o volume: derivado da producao ou escrito a mao. NULL enquanto nao houver volume. Existe para que uma correccao manual seja visivel na auditoria em vez de silenciosa.';

-- O estado de uma semana, com a ordem que importa: aprovada vence submetida, submetida
-- vence rascunho, e a ausencia de registo e um estado seu, nao um nulo.
CREATE OR REPLACE FUNCTION public.scorecard_week_board(_week_ending date)
RETURNS TABLE (
  leader_id uuid, leader_name text, line_id uuid, line_name text,
  entry_id uuid, state text,
  volume_rag text, quality_rag text, hs_rag text, overall_rag text,
  rag_driver text, capa_required boolean
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    a.leader_id, ll.name, a.line_id, ln.name,
    w.id,
    CASE
      WHEN w.id IS NULL            THEN 'por preencher'
      WHEN w.approved_at IS NOT NULL THEN 'aprovada'
      WHEN w.submitted_at IS NOT NULL THEN 'submetida'
      ELSE 'rascunho'
    END,
    w.volume_rag, w.quality_rag, w.hs_rag, w.overall_rag,
    w.rag_driver, w.capa_required
  FROM public.leader_line_assignment a
  JOIN public.line_leaders ll ON ll.id = a.leader_id
  JOIN public.lines        ln ON ln.id = a.line_id
  LEFT JOIN public.v_leader_weekly_scorecard w
         ON w.leader_id = a.leader_id
        AND w.line_id   = a.line_id
        AND w.week_ending = _week_ending
  WHERE _week_ending >= a.valid_from
    AND (a.valid_to IS NULL OR _week_ending <= a.valid_to)
  ORDER BY ll.name, ln.name;
$$;

-- O volume que a producao ja registou para aquela linha naquela semana. Duas equipas na
-- mesma linha recebem o MESMO valor: repartir exigiria saber que fraccao da semana coube
-- a cada uma, coisa que ninguem regista, e inventa-la seria pior do que mostrar o total
-- com a origem a vista.
--
-- rag_weekly_entries nao tem line_id: a linha e associada por nome (public.lines.name),
-- com a mesma comparacao tolerante a maiusculas/espacos que rag_actual_from_floor ja usa
-- em producao (migracao 20260730100000). As grafias conhecidas ja foram unificadas
-- (20260801080000 e 20260801100000), mas nada impede outra grafia nova de aparecer entre
-- as duas tabelas amanha; a comparacao tolerante custa nada e evita que essa proxima
-- divergencia volte a partir esta soma silenciosamente. downtime_min ja vive em
-- rag_weekly_entries por registo — nao existe (nem e preciso) juntar a tabela
-- public.downtime, que e outra coisa.
CREATE OR REPLACE FUNCTION public.scorecard_derived_volume(_line_id uuid, _week_ending date)
RETURNS TABLE (
  planned_volume integer, actual_volume integer,
  unplanned_downtime_minutes integer, source_label text
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  -- No NULLIF here. sum() already gives us the one true absence: no rows joined at
  -- all, because a line with nothing recorded that week has nothing to sum. A real
  -- recorded zero — a line that genuinely produced nothing, or genuinely lost no
  -- unplanned minutes — is a FACT and must read as 0, not be folded back into
  -- "unrecorded". Turning it into NULL would be this function inventing the very
  -- blank-vs-zero confusion the rest of this module exists to refuse.
  SELECT
    sum(e.plan_qty)::integer,
    sum(e.actual_qty)::integer,
    sum(e.downtime_min)::integer,
    'RAG Weekly'
  FROM public.rag_weekly_entries e
  JOIN public.lines ln ON ln.id = _line_id
   AND LOWER(REPLACE(BTRIM(ln.name), ' ', '')) = LOWER(REPLACE(BTRIM(e.line), ' ', ''))
  WHERE e.entry_date BETWEEN _week_ending - 6 AND _week_ending;
$$;

REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scorecard_derived_volume(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scorecard_derived_volume(uuid, date) TO authenticated;

