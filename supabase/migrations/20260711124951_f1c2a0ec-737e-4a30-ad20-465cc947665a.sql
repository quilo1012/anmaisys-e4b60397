DO $$
DECLARE
  acc record;
  new_user_id uuid;
  existing_user_id uuid;
  pwd_hash text;
BEGIN
  pwd_hash := extensions.crypt('Tablet@AN2026!', extensions.gen_salt('bf', 10));

  FOR acc IN
    SELECT id, user_id, email, label
    FROM public.operator_line_accounts
    WHERE COALESCE(active, true) = true
  LOOP
    SELECT id INTO existing_user_id
    FROM auth.users
    WHERE lower(email) = lower(acc.email)
    LIMIT 1;

    IF existing_user_id IS NULL THEN
      new_user_id := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        confirmation_sent_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        new_user_id,
        'authenticated',
        'authenticated',
        lower(acc.email),
        pwd_hash,
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', acc.label),
        now(),
        now()
      );
    ELSE
      new_user_id := existing_user_id;

      UPDATE auth.users
      SET encrypted_password = pwd_hash,
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          confirmation_sent_at = COALESCE(confirmation_sent_at, now()),
          raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', acc.label),
          updated_at = now()
      WHERE id = new_user_id;
    END IF;

    UPDATE public.operator_line_accounts
    SET user_id = new_user_id
    WHERE id = acc.id;

    INSERT INTO public.profiles (id, name, email, active)
    VALUES (new_user_id, acc.label, lower(acc.email), true)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        email = EXCLUDED.email,
        active = true,
        updated_at = now();

    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = new_user_id) THEN
      UPDATE public.user_roles
      SET role = 'operator'
      WHERE user_id = new_user_id;
    ELSE
      INSERT INTO public.user_roles (user_id, role)
      VALUES (new_user_id, 'operator');
    END IF;
  END LOOP;
END $$;