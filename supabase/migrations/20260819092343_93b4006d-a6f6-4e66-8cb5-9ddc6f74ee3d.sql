DO $$
DECLARE
  _constraint_name text;
BEGIN
  SELECT conname INTO _constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.quality_actions'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                        WHERE attrelid = 'public.quality_actions'::regclass
                          AND attname = 'leader_id')]
  LIMIT 1;

  IF _constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.quality_actions DROP CONSTRAINT %I', _constraint_name);
  END IF;
END $$;

UPDATE public.quality_actions AS qa
   SET leader_id = ll.id
  FROM public.line_leaders AS ll
 WHERE qa.leader_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.line_leaders x WHERE x.id = qa.leader_id)
   AND upper(btrim(qa.leader_name)) = upper(btrim(ll.name))
   AND (SELECT count(*) FROM public.line_leaders y
         WHERE upper(btrim(y.name)) = upper(btrim(qa.leader_name))) = 1;

UPDATE public.quality_actions AS qa
   SET leader_id = NULL
 WHERE qa.leader_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.line_leaders x WHERE x.id = qa.leader_id);

ALTER TABLE public.quality_actions
  ADD CONSTRAINT quality_actions_leader_id_fkey
  FOREIGN KEY (leader_id) REFERENCES public.line_leaders(id) ON DELETE RESTRICT;
