
ALTER TABLE public.work_orders RENAME COLUMN line TO requester_name;
ALTER TABLE public.work_orders ADD COLUMN signed_by_name text;
