-- rag_weekly_comments: a leitura era `USING (true)`.
--
-- Estes comentários dizem como correu a semana de cada linha e de cada pessoa, e
-- qualquer sessão autenticada os lia — incluindo as 13 contas de tablet de linha, que
-- são partilhadas por quem passa no chão de fábrica. A fuga gémea, em
-- leader_weekly_scorecard, já tinha sido fechada com `is_owner OR <perfis de gestão>`;
-- é esse o padrão seguido aqui.
--
-- Quem lê passa a ser quem detém `rag.view` na matriz (src/lib/permissions.ts) depois da
-- reforma de perfis de 10/09/2026 — admin, manager, maintenance_manager,
-- production_office_admin — mais o owner, a válvula de emergência.

DROP POLICY IF EXISTS "Authenticated can read rag comments" ON public.rag_weekly_comments;

CREATE POLICY "Management reads rag comments"
ON public.rag_weekly_comments
FOR SELECT
TO authenticated
USING (
  is_owner(auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'maintenance_manager'::app_role)
  OR has_role(auth.uid(), 'production_office_admin'::app_role)
);

-- Escrita: só arrumação, sem alargar nada.
--
-- 1) O UPDATE do supervisor. Perfil reformado a 10/09/2026: ninguém o tem, a policy
--    nunca dá verdade e só engrossa a lista que se lê quando se procura um problema.
DROP POLICY IF EXISTS "supervisor update rag comments" ON public.rag_weekly_comments;

-- 2) O INSERT chamava-se "Admins Managers Supervisors insert rag comments" e o nome
--    deixou de descrever o que faz. Deixava entrar admin, manager e supervisor; o
--    supervisor está reformado, e o production_office_admin já entrava pela policy ALL
--    "office_admin rag comments" sem aparecer neste nome. Recriada com o mesmo efeito
--    real de hoje e alinhada com `rag.comment` na matriz: admin, manager,
--    production_office_admin.
DROP POLICY IF EXISTS "Admins Managers Supervisors insert rag comments" ON public.rag_weekly_comments;

CREATE POLICY "Management writes rag comments"
ON public.rag_weekly_comments
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'production_office_admin'::app_role)
);

-- O DELETE de admin e o UPDATE de admin/manager ficam exactamente como estavam, tal
-- como a policy ALL do production_office_admin.

ALTER TABLE public.rag_weekly_comments ENABLE ROW LEVEL SECURITY;