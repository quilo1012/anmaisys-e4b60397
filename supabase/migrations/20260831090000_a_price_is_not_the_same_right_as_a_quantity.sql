-- `stock.pricing` is admin-only in the matrix and governs nothing anywhere.
--
-- The matrix says `"stock.pricing": ["admin"]` and describes it as "See and edit part
-- unit prices and financial values." No screen asks for it and no policy mentions it.
-- What actually decides who edits a price today is `stock.manage` in the UI — which
-- StockPage reads to draw the whole edit dialog, price field included — and, in the
-- database, the plain UPDATE policies on `products`: admin, manager, supervisor and
-- maintenance_manager. Four roles where the matrix names one, and an admin turning
-- `stock.pricing` off changes nothing for any of them.
--
-- A price is not the same right as a quantity. Adjusting stock after a part is used is
-- the job most of those roles are there to do; changing what the part is worth is a
-- financial figure, and the matrix has said so all along.
--
-- Row-level security cannot express this: the right depends on WHICH column moved, and
-- a policy only ever sees the whole row. So it is a trigger, and it fires only when
-- `price` actually changes — `IS DISTINCT FROM`, not "price was in the statement".
-- That distinction is the whole design. `useUpdateProduct` sends every column on every
-- save, price included, so a trigger keyed on the statement rather than on the value
-- would refuse every ordinary product edit by a manager and teach them the app is
-- broken. This refuses exactly one thing: a price that moved, by somebody without the
-- right to move it.
--
-- The permission is read with `has_action` (20260813094905), so the switch on the
-- Permissions page is the switch, not a second list written here that nobody can edit.
-- That is the point: `stock.pricing` becomes true rather than being deleted.

CREATE OR REPLACE FUNCTION public.enforce_product_pricing_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- A price that did not move needs no right. An INSERT with no price, or a zero
  -- price, is a part being catalogued rather than valued — the add form leaves the
  -- field empty and sends nothing.
  IF TG_OP = 'INSERT' THEN
    IF NEW.price IS NULL OR NEW.price = 0 THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.price IS NOT DISTINCT FROM OLD.price THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT public.has_action(auth.uid(), 'stock.pricing', ARRAY['admin']::app_role[]) THEN
    RAISE EXCEPTION
      'Changing a part price needs the stock.pricing permission.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_product_pricing_permission() IS
  'Refuses a products.price that moved when the caller lacks stock.pricing. Fires on '
  'the value, never on the statement: useUpdateProduct sends price on every save, so '
  'gating the statement would refuse every ordinary product edit.';

DROP TRIGGER IF EXISTS trg_products_pricing_permission ON public.products;
CREATE TRIGGER trg_products_pricing_permission
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_pricing_permission();
