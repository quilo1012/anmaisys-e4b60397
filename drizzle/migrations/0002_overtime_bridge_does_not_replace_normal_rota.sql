-- A Day overtime bridge row must not suppress a normal Night rota (or vice versa).
-- Keep the established hours, absence and historical rota rules unchanged.
DO $$
DECLARE
  definition text := pg_get_functiondef('public.overtime_schedule_clash(uuid,uuid)'::regprocedure);
  old_block text := E'      v_drawn := true;\n      -- Rows an ask wrote are the accepted answers above, read with their own hours.\n      continue when b.overtime_request_id is not null;';
  new_block text := E'      -- Overtime bridge rows add hours; they never replace the normal rota.\n      continue when b.overtime_request_id is not null;\n      -- Only a manual row on the regular board overrides that date\'s rota.\n      if b.shift = v_board then v_drawn := true; end if;';
BEGIN
  IF position(new_block in definition) > 0 THEN RETURN; END IF;
  IF position(old_block in definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected overtime_schedule_clash definition; no change applied';
  END IF;
  EXECUTE replace(definition, old_block, new_block);
END $$;