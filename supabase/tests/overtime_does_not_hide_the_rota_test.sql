-- Synthetic records only; rollback leaves production unchanged.
BEGIN;
DO $$
DECLARE
  employee uuid; pattern uuid; day_ask uuid; night_ask uuid;
  owner_id uuid; reason text; user_id uuid := gen_random_uuid(); refused boolean := false;
BEGIN
  SELECT id INTO owner_id FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO auth.users(id,email,instance_id,aud,role)
  VALUES(user_id,'zz-'||user_id||'@example.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  INSERT INTO public.shift_patterns(name,days,starts_at,ends_at)
  VALUES ('ZZ Night overlap regression',ARRAY[1,2,3,4]::smallint[],'18:00','06:00')
  RETURNING id INTO pattern;
  INSERT INTO public.employees(full_name,shift_group,shift_pattern_id,active,user_id)
  VALUES ('ZZ Night overlap regression','Night',pattern,true,user_id) RETURNING id INTO employee;
  INSERT INTO public.overtime_requests(on_date,starts_at,ends_at,headcount,created_by)
  VALUES ('2026-10-21','06:00','18:00',4,owner_id) RETURNING id INTO day_ask;
  INSERT INTO public.overtime_requests(on_date,starts_at,ends_at,headcount,created_by)
  VALUES ('2026-10-21','18:00','06:00',4,owner_id) RETURNING id INTO night_ask;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',user_id,'role','authenticated')::text,true);
  PERFORM public.answer_overtime(day_ask,'yes');
  reason := public.overtime_schedule_clash(employee,night_ask);
  IF reason IS NULL OR reason NOT LIKE 'Your rota has you on the night shift%' THEN
    RAISE EXCEPTION 'Day overtime hid Wednesday Night rota: %',reason;
  END IF;
  BEGIN
    PERFORM public.answer_overtime(night_ask,'yes');
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'These hours are already yours:%' THEN RAISE; END IF;
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Night acceptance was not refused'; END IF;
  IF EXISTS(SELECT 1 FROM public.daily_allocations WHERE employee_id=employee AND shift='Night') THEN
    RAISE EXCEPTION 'Refused Night answer created a board row';
  END IF;
  PERFORM set_config('request.jwt.claims','',true);
  -- Even the request's own bridge row must not erase its underlying normal rota.
  INSERT INTO public.daily_allocations(on_date,shift,employee_id,status,overtime_request_id)
  VALUES ('2026-10-21','Night',employee,'overtime',night_ask);
  reason := public.overtime_schedule_clash(employee,night_ask);
  IF reason IS NULL OR reason NOT LIKE 'Your rota has you on the night shift%' THEN
    RAISE EXCEPTION 'Own bridge row hid Wednesday Night rota: %',reason;
  END IF;
  -- A date-specific absence on the normal board still replaces the rota.
  UPDATE public.daily_allocations SET status='holiday',overtime_request_id=NULL
   WHERE employee_id=employee AND shift='Night' AND on_date='2026-10-21';
  IF public.overtime_schedule_clash(employee,night_ask) IS NOT NULL THEN
    RAISE EXCEPTION 'Manual holiday no longer overrides Night rota';
  END IF;
  RAISE NOTICE 'ALL TESTS PASSED: Day overtime, refused Night acceptance, own bridge and manual absence';
END $$;
ROLLBACK;