UPDATE auth.users u
SET encrypted_password = extensions.crypt('Tablet@AN2026', extensions.gen_salt('bf')),
    updated_at = now()
FROM public.operator_line_accounts a
WHERE a.email = u.email;