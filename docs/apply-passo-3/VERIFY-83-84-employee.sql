-- VERIFICAR os blocos 83 e 84 — a função "employee"
--
-- Correr UMA query de cada vez: o editor só mostra o resultado da última.

-- ── 1. O valor existe ────────────────────────────────────────────────────────
-- TEM DE DEVOLVER UMA LINHA: employee.
select e.enumlabel
  from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'app_role' and e.enumlabel = 'employee';

-- ── 2. O link de convite cria employee ───────────────────────────────────────
-- TEM DE DEVOLVER employee (ou null, se o registo estiver na fila de aprovação de
-- propósito). "operator" quer dizer que o bloco 84 não correu.
select self_signup_role from public.signup_config where id;
