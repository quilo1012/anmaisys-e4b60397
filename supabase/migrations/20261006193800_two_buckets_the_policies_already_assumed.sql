-- Dois buckets que as políticas já presumiam, e que nenhuma migração criava.
--
-- `part-photos` tem políticas desde 26/08 (e revistas a 08/09 e 18/09).
-- `technical-docs` tem políticas desde 21/09. A app lê e escreve nos dois:
-- `usePartPhotos.ts` e `useTechnicalInfo.ts`.
--
-- Nenhum dos dois foi alguma vez criado por uma migração. Existem em produção
-- porque alguém os criou à mão no painel. O que ficou escrito no repositório
-- foram as políticas — regras sobre um bucket que o SQL nunca cria.
--
-- Numa base nova as políticas aplicam-se a um bucket que não está lá, e os ecrãs
-- falham com "Bucket not found": a fotografia de peças no Stock, e o repositório
-- técnico inteiro de manuais e procedimentos de máquina.
--
-- Verificado a 06/10/2026 no destino da migração `ammlyqnjlhioukpgldgc`: tem
-- `dm-audio`, `part-photos`, `quality-photos` e `wo-photos` — e **não** tem
-- `technical-docs`. O `part-photos` também lá está por mão humana, não por este
-- SQL; entra aqui para que a próxima base não dependa de ninguém se lembrar.
--
-- É a mesma classe de falha que o `AGENTS.md` já regista para vistas e funções
-- ("Database objects the app reads must exist in a migration"), aplicada a
-- buckets, que o teste existente não cobria. Passa a cobrir — ver
-- `src/__tests__/aAppNaoLeNenhumBucketQueNaoEstejaNumaMigracao.test.ts`.
--
-- Os dois são privados, e isso não é escolha deste ficheiro:
--   * `part-photos` foi documentado como privado quando as políticas foram
--     escritas ("live in the private part-photos bucket");
--   * `technical-docs` é lido por `createSignedUrl`, que só um bucket privado
--     precisa.
--
-- Idempotente de propósito: a produção já tem os dois, e aqui isto não faz nada.

INSERT INTO storage.buckets (id, name, public)
VALUES ('part-photos', 'part-photos', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('technical-docs', 'technical-docs', false)
ON CONFLICT (id) DO NOTHING;
