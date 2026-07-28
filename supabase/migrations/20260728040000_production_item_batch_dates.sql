-- Batch traceability: capture the manufacture month and expiry month alongside
-- the batch code when an operator logs production. Stored as the first day of
-- the month (date). Applied live; kept for the record.
ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS manufacture_month date,
  ADD COLUMN IF NOT EXISTS expiry_month date;
