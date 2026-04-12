ALTER TABLE parts_used DROP CONSTRAINT parts_used_work_order_id_fkey;
ALTER TABLE parts_used ADD CONSTRAINT parts_used_work_order_id_fkey 
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;

ALTER TABLE downtime DROP CONSTRAINT downtime_work_order_id_fkey;
ALTER TABLE downtime ADD CONSTRAINT downtime_work_order_id_fkey 
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;