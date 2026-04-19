-- ============================================================
-- LINE-CENTRIC SIMPLIFICATION
-- 1. Reuse existing `lines` table (no new production_lines table)
-- 2. New `mobile_assets` table for printers/bag sealers
-- 3. ADD line_id + mobile_asset_id to work_orders, KEEP machine text for legacy
-- ============================================================

-- ---- 1. mobile_assets ----------------------------------------
CREATE TYPE public.mobile_asset_type AS ENUM ('printer', 'bag_sealer');

CREATE TABLE public.mobile_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type public.mobile_asset_type NOT NULL,
  asset_number int NOT NULL,
  current_line_id uuid REFERENCES public.lines(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_type, asset_number)
);

ALTER TABLE public.mobile_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view mobile_assets"
  ON public.mobile_assets FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage mobile_assets"
  ON public.mobile_assets FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers manage mobile_assets"
  ON public.mobile_assets FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- Seed: 2 real Printers (P1, P2) currently on Filler Line 3 / Filler Line 5
-- (Bag Sealers + remaining Printers can be added via UI later)
INSERT INTO public.mobile_assets (asset_type, asset_number, current_line_id)
SELECT 'printer'::mobile_asset_type, 1, id FROM public.lines WHERE name = 'Filler Line 3';

INSERT INTO public.mobile_assets (asset_type, asset_number, current_line_id)
SELECT 'printer'::mobile_asset_type, 2, id FROM public.lines WHERE name = 'Filler Line 5';

-- ---- 2. work_orders: add line_id + mobile_asset_id -----------
ALTER TABLE public.work_orders
  ADD COLUMN line_id uuid REFERENCES public.lines(id) ON DELETE SET NULL,
  ADD COLUMN mobile_asset_id uuid REFERENCES public.mobile_assets(id) ON DELETE SET NULL;

-- Backfill line_id for any historical WOs by matching line_at_time → lines.name
UPDATE public.work_orders wo
SET line_id = l.id
FROM public.lines l
WHERE wo.line_id IS NULL
  AND wo.line_at_time IS NOT NULL
  AND l.name = wo.line_at_time;

-- ---- 3. Trigger: keep line_at_time in sync with line_id ------
CREATE OR REPLACE FUNCTION public.work_orders_set_line_at_time_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- New line-centric path: prefer line_id when provided
  IF NEW.line_id IS NOT NULL THEN
    SELECT name INTO NEW.line_at_time FROM public.lines WHERE id = NEW.line_id;
    RETURN NEW;
  END IF;

  -- Legacy path: derive from machine name (preserved for backward compat)
  IF NEW.line_at_time IS NULL AND NEW.machine IS NOT NULL AND NEW.machine <> '' THEN
    SELECT
      CASE m.category
        WHEN 'line_fixed'  THEN m.fixed_line
        WHEN 'line_mobile' THEN COALESCE(m.current_line, NULLIF(m.line, ''))
        ELSE NULLIF(m.line, '')
      END
      INTO NEW.line_at_time
    FROM public.machines m
    WHERE m.name = NEW.machine
    LIMIT 1;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wo_set_line_at_time ON public.work_orders;
CREATE TRIGGER trg_wo_set_line_at_time
  BEFORE INSERT OR UPDATE OF line_id, machine ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.work_orders_set_line_at_time_v2();

-- ---- 4. Make machine column nullable (new WOs use line_id) ---
ALTER TABLE public.work_orders ALTER COLUMN machine DROP NOT NULL;
ALTER TABLE public.work_orders ALTER COLUMN machine SET DEFAULT '';