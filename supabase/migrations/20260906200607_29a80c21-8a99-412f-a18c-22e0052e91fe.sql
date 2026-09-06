ALTER TABLE public.sc_classification_rules
  ADD COLUMN IF NOT EXISTS line_name text;

COMMENT ON COLUMN public.sc_classification_rules.line_name IS
  'When set, a matching rule also attributes the action to this production line (must match public.lines.name).';