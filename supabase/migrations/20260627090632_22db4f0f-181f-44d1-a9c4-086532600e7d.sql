DO $$
DECLARE
  _constraint_name text;
BEGIN
  SELECT conname INTO _constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.production_sessions'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.production_sessions'::regclass AND attname = 'leader_id')]
  LIMIT 1;

  IF _constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.production_sessions DROP CONSTRAINT %I', _constraint_name);
  END IF;
END $$;

ALTER TABLE public.production_sessions
  ADD CONSTRAINT production_sessions_leader_id_fkey
  FOREIGN KEY (leader_id) REFERENCES public.line_leaders(id) ON DELETE SET NULL;