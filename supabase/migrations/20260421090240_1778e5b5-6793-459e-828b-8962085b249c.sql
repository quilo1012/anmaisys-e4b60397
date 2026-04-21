-- Prevent privilege escalation via supplementary role rows
-- Each user must have at most one role row. This makes the manager-insert
-- policy's check (target user is not admin/manager) tamper-proof: a manager
-- cannot add an "engineer" row to a user who is already an admin, because
-- the unique constraint will reject the insert.
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);