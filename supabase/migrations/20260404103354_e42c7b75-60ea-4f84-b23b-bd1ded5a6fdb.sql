
-- Revoke SELECT on pin_hash column to prevent exposure
REVOKE SELECT (pin_hash) ON public.engineers FROM authenticated;
REVOKE SELECT (pin_hash) ON public.engineers FROM anon;
