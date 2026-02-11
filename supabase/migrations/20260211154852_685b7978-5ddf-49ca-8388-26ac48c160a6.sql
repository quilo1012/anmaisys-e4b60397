
-- Create products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'spare',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create parts_used table
CREATE TABLE public.parts_used (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id),
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity INTEGER NOT NULL,
  engineer_id UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts_used ENABLE ROW LEVEL SECURITY;

-- Products RLS: Engineers and Admins can SELECT
CREATE POLICY "Engineers and admins can view products"
ON public.products FOR SELECT
USING (has_role(auth.uid(), 'engineer') OR has_role(auth.uid(), 'admin'));

-- Products: Admins can INSERT
CREATE POLICY "Admins can insert products"
ON public.products FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Products: Admins can UPDATE
CREATE POLICY "Admins can update products"
ON public.products FOR UPDATE
USING (has_role(auth.uid(), 'admin'));

-- Products: Admins can DELETE
CREATE POLICY "Admins can delete products"
ON public.products FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Parts used: Engineers can SELECT own, admins can SELECT all
CREATE POLICY "Engineers can view own parts used"
ON public.parts_used FOR SELECT
USING (engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- Parts used: Engineers can INSERT own records
CREATE POLICY "Engineers can insert parts used"
ON public.parts_used FOR INSERT
WITH CHECK (engineer_id = auth.uid() AND has_role(auth.uid(), 'engineer'));

-- Trigger: auto-reduce stock on parts_used INSERT
CREATE OR REPLACE FUNCTION public.reduce_stock_on_parts_used()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET quantity = quantity - NEW.quantity
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reduce_stock
AFTER INSERT ON public.parts_used
FOR EACH ROW
EXECUTE FUNCTION public.reduce_stock_on_parts_used();

-- Updated_at trigger for products
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime on products
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
