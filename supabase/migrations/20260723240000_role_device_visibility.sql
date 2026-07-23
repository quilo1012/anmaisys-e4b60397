-- Extend per-role visibility to per DEVICE (tablet + mobile). A row (role, action, device)
-- means that screen is HIDDEN on that device for that role. Desktop is never hidden.
ALTER TABLE public.role_mobile_hidden ADD COLUMN IF NOT EXISTS device text NOT NULL DEFAULT 'mobile';
ALTER TABLE public.role_mobile_hidden DROP CONSTRAINT IF EXISTS role_mobile_hidden_pkey;
ALTER TABLE public.role_mobile_hidden ADD CONSTRAINT role_mobile_hidden_pkey PRIMARY KEY (role, action, device);
