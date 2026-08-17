-- Safety gets its own label list.
--
-- The safety form shared the quality labels — Batch code, CCP, Foreign Body, GMP —
-- none of which name a hazard, which is why safety occurrences were logged with no
-- label at all. `quality_options` already holds the editable lists; this only widens
-- what a `kind` may be and seeds the eight hazards the log is written against.
--
-- Unpriced on purpose: a safety occurrence scores 0 (see actionPoints), so `points`
-- stays at its 0 default and the manager hides the price box for this kind.
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
