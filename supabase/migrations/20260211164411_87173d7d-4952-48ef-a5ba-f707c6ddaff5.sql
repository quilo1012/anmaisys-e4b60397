CREATE TRIGGER trg_reduce_stock_on_parts_used
  AFTER INSERT ON parts_used
  FOR EACH ROW
  EXECUTE FUNCTION reduce_stock_on_parts_used();