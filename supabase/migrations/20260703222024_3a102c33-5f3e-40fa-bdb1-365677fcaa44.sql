CREATE OR REPLACE FUNCTION public.current_user_line_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _line_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) Prefer operator_line_accounts (multi-line operators). Take the first bound line.
  SELECT ola.line_ids[1]
    INTO _line_id
    FROM public.operator_line_accounts ola
   WHERE ola.user_id = _uid
     AND array_length(ola.line_ids, 1) > 0
   LIMIT 1;

  IF _line_id IS NOT NULL THEN
    RETURN _line_id;
  END IF;

  -- 2) Fallback: legacy profiles.production_line -> lines.name
  SELECT l.id
    INTO _line_id
    FROM public.profiles p
    JOIN public.lines l ON l.name = p.production_line
   WHERE p.id = _uid
   LIMIT 1;

  RETURN _line_id;
END;
$$;