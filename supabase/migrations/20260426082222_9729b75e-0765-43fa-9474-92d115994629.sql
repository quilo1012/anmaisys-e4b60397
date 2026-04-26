-- Bulk-rename operator tablet emails to @appliednutrition.uk and reset password
-- to Tablet@AN2026! for ALL tablet accounts (including the existing LINE 1).

DO $$
DECLARE
  rec record;
  new_email text;
  pwd_hash text;
BEGIN
  -- bcrypt hash of 'Tablet@AN2026!' generated via crypt()
  pwd_hash := extensions.crypt('Tablet@AN2026!', extensions.gen_salt('bf', 10));

  FOR rec IN
    SELECT id, label, email, user_id
    FROM public.operator_line_accounts
  LOOP
    -- Compute target email from current local-part (already line1, line2, ...)
    -- Strip 'operator.' prefix if present, then replace domain.
    new_email := lower(
      regexp_replace(split_part(rec.email, '@', 1), '^operator\.', '')
      || '@appliednutrition.uk'
    );

    -- Update auth.users (email + confirmed + password)
    UPDATE auth.users
       SET email = new_email,
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           encrypted_password = pwd_hash,
           updated_at = now()
     WHERE id = rec.user_id;

    -- Update mirror tables
    UPDATE public.operator_line_accounts
       SET email = new_email, updated_at = now()
     WHERE id = rec.id;

    UPDATE public.profiles
       SET email = new_email, updated_at = now()
     WHERE id = rec.user_id;
  END LOOP;
END $$;