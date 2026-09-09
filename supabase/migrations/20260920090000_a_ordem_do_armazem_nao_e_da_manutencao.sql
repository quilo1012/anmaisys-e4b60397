-- A ordem do armazém não é da manutenção.
--
-- A `20260919090000` fez a espera de embalagem abrir a sua própria ordem, do
-- tipo `warehouse_service`, e deu ao papel `warehouse` uma policy para a ver. O
-- que não fez foi tirá-la a quem já via tudo: `Engineers can view WOs` é
-- `has_role(auth.uid(), 'engineer')` e mais nada, sem uma palavra sobre
-- `wo_type`. As policies de leitura são permissivas e somam-se, portanto a
-- ordem nova entrou na vista dos engenheiros pela porta que já estava aberta.
--
-- No dia 09/09 foi exactamente isso que aconteceu: a primeira ordem de armazém
-- apareceu no quadro do engenheiro, dentro do contador "Open Maintenance
-- Order(s) Waiting!", e tocou-lhe a sirene. Um trabalho que não é dele, que ele
-- não consegue fechar, e que ninguém lhe explicou.
--
-- UMA POLICY RESTRITIVA, E NÃO UMA EMENDA ÀS QUE EXISTEM. Há sete policies de
-- leitura nesta tabela e a resposta certa está na intersecção de todas: as
-- ordens de armazém são do armazém, ponto. Emendar as sete uma a uma seria sete
-- oportunidades de enganar-me e sete sítios para a próxima pessoa ter de
-- lembrar-se de repetir a regra. Uma restritiva soma-se por AND a tudo o que
-- houver, agora e no futuro, e diz a regra uma vez só.
--
-- `FOR ALL` e não `FOR SELECT`: um engenheiro que não pode ver a ordem também
-- não tem nada que a escrever, e `Engineers can update locked or unlocked WOs`
-- deixá-lo-ia fazê-lo às cegas. Numa policy restritiva sem `WITH CHECK` o
-- Postgres usa o `USING` também para a verificação de escrita, que é o que se
-- quer aqui.
--
-- QUEM FICA. `warehouse` e `admin`. É o que foi decidido, e é mais estreito do
-- que o desenho anterior: o líder de linha (papel `operator`) via a ordem da
-- sua própria linha por causa de `Operators view own or assigned-line WOs`, e
-- deixa de a ver. Fica registado aqui porque é a consequência menos óbvia
-- desta migração, e a que se há-de querer rever primeiro.
--
-- O poll não é afectado: corre com a service role, que não passa por RLS.
--
-- Já aplicada à base a 09/09/2026 pelo MCP do Lovable. Este ficheiro é o
-- registo, e é idempotente para poder correr outra vez sem estoirar.

DROP POLICY IF EXISTS "Warehouse orders belong to the warehouse" ON public.work_orders;

CREATE POLICY "Warehouse orders belong to the warehouse"
ON public.work_orders
AS RESTRICTIVE
FOR ALL
TO public
USING (
  coalesce(wo_type, 'production') <> 'warehouse_service'
  OR has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role::text = 'warehouse'
  )
);
