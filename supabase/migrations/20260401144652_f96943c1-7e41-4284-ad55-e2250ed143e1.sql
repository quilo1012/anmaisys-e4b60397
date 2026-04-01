ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_engineer_id_fkey;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_engineer_id_fkey 
  FOREIGN KEY (engineer_id) REFERENCES engineers(id);