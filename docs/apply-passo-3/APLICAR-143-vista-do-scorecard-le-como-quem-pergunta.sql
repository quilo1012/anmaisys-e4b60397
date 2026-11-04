-- APLICAR 143 — a vista do scorecard semanal volta a ler como quem pergunta.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 143 do APPLY-ALL-IN-ORDER.sql, byte a byte. Não depende do 142.
--
-- Porquê (auditoria 02/11, DB-001): em produção v_leader_weekly_scorecard tem o
-- security_invoker desligado e o anon tem SELECT nela. Sem security_invoker a vista corre
-- como o dono e passa por cima do RLS: a chave pública lia os scores semanais dos líderes.
-- Foi a migração de 01/10 (pontualidade) que a reconstruiu com CREATE OR REPLACE sem WITH.
--
-- O que muda: só a opção da vista (a definição fica igual) e o grant do anon nela.
-- Quem tem sessão continua a ver o que o RLS deixa. Pode colar-se duas vezes.
--
-- Depois de colar: correr VERIFY-143-vista-do-scorecard.sql (só lê). As duas linhas: ok.
--
-- EN: Paste the whole file; it is BLOCO 143. It turns security_invoker back on for
-- v_leader_weekly_scorecard and revokes anon on it. Then run VERIFY-143.

-- ================================================================
-- BLOCO 143
-- 20261104090000_the_weekly_scorecard_view_reads_as_its_reader.sql
-- ================================================================
-- The weekly scorecard view answers as the person asking again, and anon is off it.
--
-- WHAT WAS WRONG. Audit 2026-11-02, DB-001. Production showed v_leader_weekly_scorecard
-- with security_invoker off while SELECT was granted to anon. A view without
-- security_invoker runs as its owner, so the public key in the bundle read the leaders'
-- weekly scores past every RLS policy on leader_weekly_scorecard and the tables it joins.
--
-- WHY. 20260826090000 made the view WITH (security_invoker = true). 20261001203000
-- rebuilt it from pg_get_viewdef with `CREATE OR REPLACE VIEW … AS`, and a CREATE OR
-- REPLACE without a WITH clause resets the view's options: security_invoker went with
-- it. The other scorecard views were never rebuilt that way and are still on.
--
-- WHAT CHANGES. The option goes back on, without touching the definition, and anon loses
-- its grant on this view. Signed-in readers see what RLS lets them see, as they did from
-- 26/08 to 01/10. Idempotent.

alter view public.v_leader_weekly_scorecard set (security_invoker = true);

revoke all on public.v_leader_weekly_scorecard from anon;
