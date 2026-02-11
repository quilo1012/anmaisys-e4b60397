
CREATE OR REPLACE FUNCTION validate_stock_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  available_qty integer;
BEGIN
  SELECT quantity INTO available_qty
  FROM products WHERE id = NEW.product_id;
  
  IF available_qty IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  
  IF available_qty < NEW.quantity THEN
    RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', available_qty, NEW.quantity;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_stock
  BEFORE INSERT ON parts_used
  FOR EACH ROW
  EXECUTE FUNCTION validate_stock_availability();
