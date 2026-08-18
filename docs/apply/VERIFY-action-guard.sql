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
--   SELECT id, wo_number, status FROM work_orders ORDER BY created_at DESC LIMIT 5;
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
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.delete', false)
ON CONFLICT (role, action) DO UPDATE SET allowed = false;

SET LOCAL request.jwt.claims = '{"sub":"<engineer_uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;  -- a claim primeiro: ja com o papel trocado podes nao a poder definir

-- ESPERADO: ERROR 42501 — Permission "wo.delete" is turned off for your role.
-- Se este DELETE passar, a guarda NÃO está instalada. Parar aqui.
DELETE FROM work_orders WHERE id = '<wo_uuid>';

ROLLBACK;

-- ── BLOCO 2: com o switch ligado, tem de passar ──────────────────────────
-- Sem este bloco, uma guarda que bloqueasse toda a gente parecia sucesso.
BEGIN;

INSERT INTO role_permission_overrides (role, action, allowed)
VALUES ('engineer', 'wo.delete', true)
ON CONFLICT (role, action) DO UPDATE SET allowed = true;

SET LOCAL request.jwt.claims = '{"sub":"<engineer_uuid>","role":"authenticated"}';
SET LOCAL ROLE authenticated;  -- a claim primeiro: ja com o papel trocado podes nao a poder definir

-- ESPERADO: DELETE 1 (ou 0 se a RLS de work_orders já o impedia por outra razão,
-- o que também é informação: nesse caso a guarda não é o que está a bloquear).
DELETE FROM work_orders WHERE id = '<wo_uuid>';

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
