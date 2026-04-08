-- Hash the existing plain-text admin PIN using bcrypt
UPDATE system_settings
SET admin_pin = crypt(admin_pin, gen_salt('bf')),
    updated_at = now()
WHERE length(admin_pin) < 20;

-- Update default for new rows to also be hashed
ALTER TABLE system_settings ALTER COLUMN admin_pin SET DEFAULT crypt('1234', gen_salt('bf'));