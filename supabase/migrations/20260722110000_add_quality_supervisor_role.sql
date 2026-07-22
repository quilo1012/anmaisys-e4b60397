-- New dedicated role for the Quality (QC) supervisor who maintains the weekly
-- quality report. Kept in its own migration because Postgres forbids using a
-- freshly added enum value later in the SAME transaction ("unsafe use of new
-- value of enum type") — the value must be committed before the follow-up
-- migration references it in policies.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'quality_supervisor';
