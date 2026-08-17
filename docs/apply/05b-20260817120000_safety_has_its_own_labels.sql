-- ================================================================
-- 20260817120000_safety_has_its_own_labels
-- ================================================================
-- Safety gets its own label list.
--
-- The safety form shared the quality labels — Batch code, CCP, Foreign Body, GMP —
-- none of which name a hazard, which is why safety occurrences were logged with no
-- label at all. `quality_options` already holds the editable lists; this only widens
-- what a `kind` may be and seeds the eight hazards the log is written against.
--
-- Unpriced on purpose: a safety occurrence scores 0 (see actionPoints), so `points`
-- stays at its 0 default and the manager hides the price box for this kind.
--
-- PORQUE É 05b E NÃO UM NONO BLOCO NO FIM: o carimbo é 20260817120000, entre o bloco
-- 05 (20260817093000) e o 06 (20260818090000). Escapou ao `pending-migrations-apply.sql`
-- quando este foi montado, e a falha aparece na app como
--   new row for relation "quality_options" violates check constraint
--   "quality_options_kind_check"
-- assim que alguém grava um rótulo de segurança. Aplicar os oito blocos sem este NÃO
-- resolve esse erro.
--
-- Depende apenas de public.quality_options (20260722150000, já aplicada). Não depende
-- do bloco 01: o INSERT não toca em `points`, e o default 0 satisfaz o
-- quality_options_only_labels_are_priced que o 01 acrescenta. Corre isolado sem risco.
ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_kind_check;
ALTER TABLE public.quality_options
  ADD CONSTRAINT quality_options_kind_check
  CHECK (kind IN ('label', 'department', 'safety_label'));

INSERT INTO public.quality_options (kind, value, sort) VALUES
  ('safety_label', 'Slip / trip / fall', 1),
  ('safety_label', 'Manual handling', 2),
  ('safety_label', 'Machine guarding', 3),
  ('safety_label', 'PPE', 4),
  ('safety_label', 'Chemical / COSHH', 5),
  ('safety_label', 'Forklift / traffic', 6),
  ('safety_label', 'Housekeeping', 7),
  ('safety_label', 'Electrical', 8)
ON CONFLICT (kind, value) DO NOTHING;
