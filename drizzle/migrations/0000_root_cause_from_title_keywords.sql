CREATE TABLE IF NOT EXISTS public.root_cause_area_keyword (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL,
  pattern text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  note text,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.root_cause_area_keyword TO authenticated;
GRANT ALL ON public.root_cause_area_keyword TO service_role;

ALTER TABLE public.root_cause_area_keyword ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read root cause keywords"
  ON public.root_cause_area_keyword FOR SELECT TO authenticated USING (true);

CREATE POLICY "Quality manages root cause keywords"
  ON public.root_cause_area_keyword FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'quality_supervisor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'quality_supervisor'));

CREATE OR REPLACE FUNCTION public.root_cause_keyword_valid_pattern()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  PERFORM '' ~* NEW.pattern;
  RETURN NEW;
EXCEPTION WHEN invalid_regular_expression THEN
  RAISE EXCEPTION 'Invalid pattern: %', NEW.pattern USING ERRCODE = '22023';
END $$;

CREATE TRIGGER trg_root_cause_keyword_valid
BEFORE INSERT OR UPDATE ON public.root_cause_area_keyword
FOR EACH ROW EXECUTE FUNCTION public.root_cause_keyword_valid_pattern();

INSERT INTO public.root_cause_area_keyword (area, pattern, sort, note) VALUES
  ('Office',      '\moffice\M',                   10, NULL),
  ('Warehouse',   '\mwarehouse\M',                20, NULL),
  ('Supplier',    '\msuppliers?\M|\mgoods? in\M', 30, 'Supplier or Goods In'),
  ('Lab',         '\mlab\M',                      40, 'Word boundary: must not match "label"'),
  ('Maintenance', '\mmaintenance\M',              50, NULL);

INSERT INTO public.quality_options (kind, value, counts_against_leader, sort)
SELECT 'root_cause', v, false,
       (SELECT coalesce(max(sort), 0) FROM public.quality_options WHERE kind = 'root_cause') + n
  FROM (VALUES ('Office', 1), ('Lab', 2)) AS t(v, n)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.quality_options
    WHERE kind = 'root_cause' AND lower(btrim(value)) = lower(v));

CREATE OR REPLACE FUNCTION public.default_root_cause_from_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _area text;
BEGIN
  IF NEW.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.labels IS NOT DISTINCT FROM OLD.labels THEN
      RETURN NEW;
    END IF;
  END IF;

  IF coalesce(NEW.domain, 'quality') = 'safety' THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(NEW.labels, ARRAY[]::text[])) AS l
     WHERE lower(btrim(l)) = 'maintenance'
  ) THEN
    NEW.root_cause_area := 'Maintenance';
    RETURN NEW;
  END IF;

  IF NEW.title IS NOT NULL AND btrim(NEW.title) <> '' THEN
    SELECT k.area INTO _area
      FROM public.root_cause_area_keyword k
     WHERE k.active AND NEW.title ~* k.pattern
     ORDER BY k.sort, k.area
     LIMIT 1;
    IF _area IS NOT NULL THEN NEW.root_cause_area := _area; END IF;
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.default_root_cause_from_label() IS
  'Preenche root_cause_area vazio a partir do rotulo Maintenance ou de uma palavra-chave de root_cause_area_keyword no titulo. Nunca sobrescreve; numa UPDATE so deriva se o titulo ou os rotulos mudaram e a causa ja estava vazia. Corre como trg_b_: depois do guard, antes do trg_quality_action_freeze_points_*.';

UPDATE public.quality_actions q
   SET root_cause_area = m.area
  FROM (
    SELECT a.id, (
      SELECT k.area FROM public.root_cause_area_keyword k
       WHERE k.active AND a.title ~* k.pattern
       ORDER BY k.sort, k.area LIMIT 1
    ) AS area
      FROM public.quality_actions a
     WHERE a.root_cause_area IS NULL
       AND coalesce(a.domain, 'quality') <> 'safety'
       AND a.title IS NOT NULL
  ) m
 WHERE q.id = m.id AND m.area IS NOT NULL;