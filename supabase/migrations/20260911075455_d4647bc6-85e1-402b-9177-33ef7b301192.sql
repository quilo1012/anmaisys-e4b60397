-- The guard is a trigger function: nothing should ever call it by name. It arrived with
-- the schema's default EXECUTE grants, which the linter flags (0028/0029) and which are
-- simply wrong for a SECURITY DEFINER function whose only job is to refuse writes.
-- Triggers run as the table owner, so revoking these does not stop it firing.
REVOKE ALL ON FUNCTION public.guard_quality_root_cause() FROM PUBLIC, anon, authenticated;