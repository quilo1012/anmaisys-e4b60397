
-- 1. Sequential WO number
CREATE SEQUENCE IF NOT EXISTS wo_number_seq START 1;
ALTER TABLE work_orders ADD COLUMN wo_number integer NOT NULL DEFAULT nextval('wo_number_seq');
CREATE UNIQUE INDEX idx_wo_number ON work_orders(wo_number);

-- 2. Allow admin to INSERT and DELETE WOs
CREATE POLICY "Admins can create WOs" ON work_orders
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete WOs" ON work_orders
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- 3. Product categories table
CREATE TABLE product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage categories" ON product_categories
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Engineers can view categories" ON product_categories
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'engineer'));

-- Seed existing categories
INSERT INTO product_categories (name) VALUES ('BFM'), ('spare'), ('consumable');
