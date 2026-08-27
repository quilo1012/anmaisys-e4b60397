-- Three leftovers from the leader rework, removed now that the evidence says nobody is
-- holding on to them.
--
-- None of this fixes a defect. It removes the material the next defect gets built out
-- of: a column that looks like it means something and is empty, and two functions that
-- PostgREST will pick if a caller happens to omit one argument.

-- =====================================================================
-- 1. The superseded create_leader / update_leader
--
-- Both exist twice, once with `_lines text[]` and once without:
--
--   create_leader(_name text, _pin text)
--   create_leader(_name text, _pin text, _lines text[])
--   update_leader(_id uuid, _name text, _active boolean, _pin text)
--   update_leader(_id uuid, _name text, _active boolean, _pin text, _lines text[])
--
-- PostgREST resolves an overload from the argument names in the JSON body, so the short
-- pair is reachable — a caller that omits `_lines` gets it, silently, and creates a
-- leader assigned to no lines at all. Which is the state that produced a zero scorecard
-- for three people in 20260906090000: a leader whose `lines` does not match production.
--
-- Both call sites pass `_lines` (ManageUsers.tsx, create at :308 and update at :338), so
-- the short pair has no caller. Dropping it turns "silently assigned to nothing" into a
-- 404 from PostgREST, which is a thing somebody notices.
-- =====================================================================

DROP FUNCTION IF EXISTS public.create_leader(_name text, _pin text);
DROP FUNCTION IF EXISTS public.update_leader(_id uuid, _name text, _active boolean, _pin text);

-- =====================================================================
-- 2. line_leaders.line — 31 rows, none of them filled
--
-- Checked four ways before dropping, because a column is not recoverable:
--
--   rows with a value ......................... 0 of 31
--   selects naming it in src/ ................. none — every read is `id, name` or
--                                               `id, name, shift`
--   functions referencing it .................. none
--   RLS policies referencing it ............... none
--   views depending on it ..................... none. Five views read this table
--                                               (v_leader_weekly_scorecard and the four
--                                               scorecard rollups) and pg_depend shows
--                                               every one of them binding `id` and
--                                               `name` only
--
-- It is the same idea as `leader_pins.line`, which is the OTHER half of this mess and is
-- deliberately NOT dropped here: that one still holds values for 12 of 25 leaders, and a
-- column with data in it is a migration that needs somebody to decide, not a tidy-up. It
-- was documented as legacy in 20260906090000 and stays that way.
-- =====================================================================

ALTER TABLE public.line_leaders DROP COLUMN IF EXISTS line;

COMMENT ON TABLE public.line_leaders IS
  'Lideres de linha, e o alvo da FK production_sessions.leader_id. Nao confundir com '
  'leader_pins, que guarda o PIN e o ARRAY de linhas que o scorecard pessoal usa: sao duas '
  'tabelas para a mesma pessoa, ligadas so por nome. Ver a auditoria de 26/08/2026 — dos 25 '
  'PINs todos tem nome igual aqui, mas 5 lideres desta tabela nao tem PIN e por isso nao '
  'conseguem abrir o proprio scorecard.';
