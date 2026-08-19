-- Prova da guarda de ações em work_orders.
-- Correr no SQL editor do projeto PMSYSTEM. Tudo dentro de BEGIN/ROLLBACK:
-- não deixa rasto, nem no override nem na work order.
--
-- Antes de correr, substituir:
--   :engineer_uuid  -> auth.users.id de um utilizador com papel engineer
--   :wo_uuid        -> work_orders.id de uma ordem descartável
--
-- Para os encontrar:
--   SELECT ur.user_id, ur.role FROM user_roles ur WHERE ur.role = 'engineer' LIMIT 5;
--   SELECT id, wo_number, status, locked_engineer_id FROM work_orders
--     ORDER BY created_at DESC LIMIT 5;
--   A ordem escolhida TEM de ter locked_engineer_id NULL (ou ser do próprio
--   engineer do teste): a política "Engineers can update locked or unlocked WOs"
--   exige isso, e uma ordem trancada a outro engenheiro é filtrada pela RLS antes
--   de o trigger disparar.
--
-- IMPORTANTE: Os três blocos abaixo correm UM DE CADA VEZ — seleciona o bloco,
-- executa-o, lê o resultado, depois o seguinte. O Bloco 1 é suposto falhar com erro 42501;
-- depois da falha, a transação está abortada e o ROLLBACK tem de ser executado sozinho
-- antes de continuares para o Bloco 2.

-- NOTA: Fechar uma work order é uma UPDATE, portanto wo_guard_update dispara em paralelo
-- com wo_guard_close. Revogar wo.update a um papel bloqueia igualmente o fecho normal e
-- o force-close. É deliberado: a negação acumula e falha fechado. A alternativa —
-- isentar escritas só-status de wo.update — deixaria um papel revogado mover a ordem para
-- in_progress ou received sem guarda nenhuma, porque só closed e force_closed têm triggers
-- próprios. Este comportamento está documentado na spec.

-- ── BLOCO 1: com o switch desligado, tem de rebentar ─────────────────────
-- Usa-se wo.update, não wo.delete: um engineer não tem nenhuma política de DELETE
-- em work_orders (sobrevivem "Admins can delete WOs" e "office_admin all", nenhuma
-- delas para engineer), portanto um DELETE de
-- engineer é filtrado pela RLS antes de o trigger BEFORE DELETE sequer disparar —
-- devolve DELETE 0 sem erro nenhum, e pareceria "a guarda não está instalada"
-- mesmo instalada. wo.update é coberto pela política "Engineers can update locked
-- or unlocked WOs", que deixa passar uma escrita inofensiva na própria ordem.
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.update', false)
ON CONFLICT (role, action) DO UPDATE SET allowed = false;

SET LOCAL request.jwt.claims = '{"sub":"<engineer_uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;  -- a claim primeiro: ja com o papel trocado podes nao a poder definir

-- ESPERADO: ERROR 42501 — Permission "wo.update" is turned off for your role.
-- Ler o resultado com cuidado, porque há três desfechos e só um é bom:
--   ERROR 42501  -> a guarda está instalada e a negar. É o que se quer.
--   UPDATE 1     -> a guarda NÃO está instalada. Parar aqui.
--   UPDATE 0     -> a RLS filtrou a linha e o trigger nunca chegou a correr.
--                   NÃO é falha da guarda: é a ordem errada. Escolher outra com
--                   locked_engineer_id NULL e repetir o bloco.
UPDATE work_orders SET priority = priority WHERE id = '<wo_uuid>';

ROLLBACK;

-- ── BLOCO 2: com o switch ligado, tem de passar ──────────────────────────
-- Sem este bloco, uma guarda que bloqueasse toda a gente parecia sucesso.
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.update', true)
ON CONFLICT (role, action) DO UPDATE SET allowed = true;

SET LOCAL request.jwt.claims = '{"sub":"<engineer_uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;  -- a claim primeiro: ja com o papel trocado podes nao a poder definir

-- ESPERADO: UPDATE 1 (ou 0 se a RLS de work_orders já o impedia por outra razão —
-- por exemplo a ordem estar locked a outro engineer — o que também é informação:
-- nesse caso a guarda não é o que está a bloquear).
UPDATE work_orders SET priority = priority WHERE id = '<wo_uuid>';

ROLLBACK;

-- ── BLOCO 3: o trabalho automático não pode ser apanhado ─────────────────
-- O par de SELECTs abaixo mostra o comportamento observável: com utilizador, um
-- engineer revogado é bloqueado (TRUE); sem utilizador, nada é bloqueado (FALSE).
-- Isto confirma que sync do iTouching e pg_cron passam sem guarda.
--
-- A cláusula auth.uid() IS NOT NULL em action_revoked é defesa em profundidade,
-- escrita para quem lê a função. Não é testável em isolamento: current_user_role()
-- já devolve NULL sem utilizador, portanto o EXISTS é false de qualquer forma,
-- com ou sem a cláusula. A observação aqui prova o comportamento, não a cláusula.
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.update', false)
ON CONFLICT (role, action) DO UPDATE SET allowed = false;

-- COM contexto de utilizador (engineer), a guarda está ativa:
-- action_revoked devolve TRUE, bloqueando a escrita.
SET LOCAL request.jwt.claims = '{"sub":"<engineer_uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;

-- ESPERADO: true
SELECT public.action_revoked('wo.update') AS deve_ser_true;

-- SEM contexto de utilizador, nada é bloqueado:
-- action_revoked devolve FALSE, deixando passar o trabalho automático.
RESET ROLE;
RESET request.jwt.claims;

-- ESPERADO: false
SELECT public.action_revoked('wo.update') AS deve_ser_false;

ROLLBACK;
