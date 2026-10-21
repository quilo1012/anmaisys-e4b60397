-- As duas colunas de gel do Headcount passam a chamar-se como as máquinas.
--
-- O quadro dizia "Gel Room" e "Gel Line". Nenhum dos dois é o nome de um posto: a GEL
-- Line tem duas máquinas, e a tabela `machines` já as nomeia — "Gel Machine" e
-- "Gel Packing", ambas na linha 6fca06ef. Quem preenche o quadro de manhã lê os nomes
-- das máquinas, não os do quadro, e tinha de traduzir de cabeça.
--
-- A tradução já estava meia-feita e escondida no `sheet_label`, que é por onde a folha
-- de Excel entra:
--
--     name "Gel Room"  ->  sheet_label "Gel Line"
--     name "Gel Line"  ->  sheet_label "Gel Machine"
--
-- Ou seja, o `name` de uma era o `sheet_label` da outra. Era disto que vinha a confusão.
--
-- Depois desta migração os dois passam a dizer a mesma coisa:
--
--     "Gel Packing"  (era "Gel Room",  236 alocações, 8 funcionários)
--     "Gel Machine"  (era "Gel Line",   65 alocações, 3 funcionários, ligada à GEL Line)
--
-- NADA SE PERDE. `daily_allocations.area_id`, `headcount_matrix.area_id` e
-- `employees.headcount_area_id` são todos `uuid` e apontam para a linha, não para o
-- nome. As 301 alocações e os 11 funcionários ficam onde estavam; só muda o cabeçalho.
--
-- A FOLHA DE EXCEL TEM DE MUDAR TAMBÉM. O `sheet_label` é o cabeçalho que o importador
-- procura no ficheiro. Alinhá-lo com o nome novo é deliberado — pedido a 21/10 — mas
-- significa que a folha do headcount tem de passar a dizer "Gel Packing" e
-- "Gel Machine" nessas duas colunas, senão a importação deixa de as encontrar.
--
-- Não confundir com `lines` nem com `20260801100000_one_name_for_the_gel_line`. Essa
-- migração unificou nomes na tabela `lines`, que é outro domínio: ali a linha chama-se
-- "GEL Line" e continua a chamar-se. Aqui mexe-se só nas colunas do Headcount.
--
-- Pela chave antiga e não pelo id, porque um id gerado não se escreve numa migração.
-- Correr duas vezes não faz nada da segunda.

UPDATE public.headcount_areas
   SET name = 'Gel Packing', sheet_label = 'Gel Packing'
 WHERE name = 'Gel Room';

UPDATE public.headcount_areas
   SET name = 'Gel Machine', sheet_label = 'Gel Machine'
 WHERE name = 'Gel Line';
