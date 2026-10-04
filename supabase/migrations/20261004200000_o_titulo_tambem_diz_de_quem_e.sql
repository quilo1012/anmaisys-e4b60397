-- O título também diz de quem é a culpa.
--
-- Até aqui só o rótulo Maintenance declarava a causa raiz. Uma acção chamada
-- "Wrong box label/Pallet label (Office)." carregava 4 pontos ao líder da linha, e
-- havia 28 assim (~93 pontos): o erro era do Office, do Warehouse, do fornecedor ou
-- do Lab, e o título dizia-o. Regra do negócio: se o título nomeia outra área, o
-- líder não é cobrado, mesmo que nomeie também a linha ("L2/Lab").
--
-- Três regras que não mudam:
--   * um valor escrito pela Qualidade nunca é sobrescrito;
--   * numa UPDATE só se deriva quando o título ou os rótulos mudaram — senão limpar a
--     causa (devolver os pontos ao líder) era desfeito no save seguinte;
--   * o gatilho continua a ser trg_b_: depois do guard, antes do freeze.

-- 1. A tabela de palavras-chave --------------------------------------------------
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

-- Uma expressão inválida gravada pela UI partia todas as escritas em quality_actions.
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

-- 2. As áreas novas têm de existir como causa que não conta ao líder -------------
-- action_points_at só zera quando encontra a área com counts_against_leader = false;
-- uma área desconhecida cobra (de propósito). Office e Lab não estavam na lista.
INSERT INTO public.quality_options (kind, value, counts_against_leader, sort)
SELECT 'root_cause', v, false,
       (SELECT coalesce(max(sort), 0) FROM public.quality_options WHERE kind = 'root_cause') + n
  FROM (VALUES ('Office', 1), ('Lab', 2)) AS t(v, n)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.quality_options
    WHERE kind = 'root_cause' AND lower(btrim(value)) = lower(v));

-- 3. O gatilho ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_root_cause_from_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _area text;
BEGIN
  -- Uma causa raiz escrita pela Qualidade manda sempre.
  IF NEW.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    -- A Qualidade limpou-a: os pontos voltam ao líder e ficam lá.
    IF OLD.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;
    -- Nada que a derivação leia mudou; validar ou fechar não re-deriva.
    IF NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.labels IS NOT DISTINCT FROM OLD.labels THEN
      RETURN NEW;
    END IF;
  END IF;

  IF coalesce(NEW.domain, 'quality') = 'safety' THEN RETURN NEW; END IF;

  -- (a) O rótulo Maintenance, como antes.
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(NEW.labels, ARRAY[]::text[])) AS l
     WHERE lower(btrim(l)) = 'maintenance'
  ) THEN
    NEW.root_cause_area := 'Maintenance';
    RETURN NEW;
  END IF;

  -- (b) A primeira palavra-chave activa que o título nomeia.
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
  'Preenche root_cause_area vazio a partir do rotulo Maintenance ou de uma palavra-chave '
  'de root_cause_area_keyword no titulo. Nunca sobrescreve; numa UPDATE so deriva se o '
  'titulo ou os rotulos mudaram e a causa ja estava vazia. Corre como trg_b_: depois do '
  'guard, antes do trg_quality_action_freeze_points_*.';


-- Os dois gatilhos, recriados iguais, para que uma base nova fique com a ordem certa:
-- trg_a_ (guard) -> trg_b_ (esta derivação) -> trg_quality_action_freeze_points_*.
DROP TRIGGER IF EXISTS trg_b_quality_root_cause_default ON public.quality_actions;
CREATE TRIGGER trg_b_quality_root_cause_default
BEFORE INSERT OR UPDATE ON public.quality_actions
FOR EACH ROW
EXECUTE FUNCTION public.default_root_cause_from_label();

--
-- One line — `root_cause_area` — and without it nothing else in this file matters.

DROP TRIGGER IF EXISTS trg_quality_action_freeze_points_upd ON public.quality_actions;

CREATE TRIGGER trg_quality_action_freeze_points_upd
BEFORE UPDATE ON public.quality_actions
FOR EACH ROW
WHEN (
  old.severity          IS DISTINCT FROM new.severity
  OR old.labels            IS DISTINCT FROM new.labels
  OR old.validation_status IS DISTINCT FROM new.validation_status
  OR old.domain            IS DISTINCT FROM new.domain
  OR old.root_cause_area   IS DISTINCT FROM new.root_cause_area
)
EXECUTE FUNCTION public.quality_action_freeze_points();


-- 4. As acções que já existem ---------------------------------------------------
-- Sem auth.uid() o guard deixa passar; o freeze repreca porque root_cause_area muda;
-- o histórico regista a mudança.
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
