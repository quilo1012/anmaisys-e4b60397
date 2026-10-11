-- APLICAR — bloco 84, SEGUNDA corrida: o link de convite passa a criar "employee"
--
-- Só depois de o APLICAR-83-employee-PRIMEIRO.sql ter corrido sem erro, numa corrida
-- separada. Byte a byte igual a supabase/migrations/20261011120100. Pode ser colado
-- mais do que uma vez.

-- The invite link makes an employee.
--
-- Needs 20261011120000 to have been run first, in a run of its own: this file uses
-- the value that one adds.
--
-- `self_signup_role` was set to 'operator' because that was the narrowest role on
-- offer. Now there is one made for it. Only an 'operator' setting is moved: null (the
-- approval queue) is an admin's deliberate choice and stays. The badge door
-- (`employee-signin`) hard-codes its role and changes in the same commit; it needs a
-- redeploy from Lovable to take effect.
--
-- Accounts that already exist keep the role they have. Turning existing operators
-- into employees takes production logging away from people who may be using it, and
-- that is a decision for Users, one person at a time, not for a migration.
--
-- Idempotent.

update public.signup_config
   set self_signup_role = 'employee'
 where self_signup_role = 'operator';
