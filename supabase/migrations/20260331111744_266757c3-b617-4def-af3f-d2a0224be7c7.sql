
CREATE OR REPLACE FUNCTION public.verify_engineer_pin(_user_id uuid, _pin text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id
      AND pin = crypt(_pin, pin)
  )
$$;

CREATE OR REPLACE FUNCTION public.set_engineer_pin(_user_id uuid, _new_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.profiles
  SET pin = crypt(_new_pin, gen_salt('bf')),
      updated_at = now()
  WHERE id = _user_id;
END;
$$;
