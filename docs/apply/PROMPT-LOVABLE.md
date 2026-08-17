# O que enviar ao Lovable, bloco a bloco

Um bloco por mensagem, de 01 a 08. Espere que cada um termine e confirme antes de enviar
o seguinte.

Cole o texto abaixo, substituindo `NN` pelo número do bloco e colando o conteúdo do
ficheiro no fim. O texto existe para impedir a única coisa que corre mal aqui: o agente
reescrever o SQL. Este SQL foi revisto e corrigido ao longo de vários ciclos, e duas das
correcções são invisíveis a quem o leia depressa.

---

Corre este SQL na base, **exactamente como está**, sem alterar uma linha.

Não o reescrevas, não o reformates, não o "melhores", não juntes nem separes comandos, e
não mudes a ordem de nada. Se achares que tem um problema, **não o corrijas** — diz-me
qual é e para, que eu decido. Este SQL passou por várias rondas de revisão e três das
suas propriedades são invisíveis a uma leitura rápida:

- Um Health & Safety em Red tem de levar o teto máximo do score, mesmo sem acidente
  nenhum — vem de formação abaixo do mínimo. Sem isso, uma semana vermelha pontua melhor
  do que a mesma semana em âmbar.
- Se um parâmetro de teto não resolver para a semana, a função tem de **falhar em voz
  alta**. `LEAST` ignora nulos, e um teto que não resolve devolveria nota máxima em
  silêncio numa semana com um CCP reprovado.
- Ausência de dados nunca é zero, nunca é Green e nunca é Amber. Não acrescentes
  `coalesce(..., 0)` a coluna nenhuma.

É o bloco **NN de 8** e a ordem entre blocos não é negociável. Não corras nenhum bloco
que eu não te tenha enviado, e não te adiantes aos seguintes.

Quando terminares, responde só com:

1. terminou sem erro, ou a mensagem de erro exacta, completa, sem a resumires;
2. a lista dos objectos que este bloco criou ou alterou, como a base os tem agora (não
   como o SQL diz que deviam ficar);
3. se alteraste alguma coisa no SQL que te dei, e o quê.

Não apliques mais nada, não geres migrações tuas, e não toques em nenhuma outra tabela.

```sql
[COLE AQUI O CONTEÚDO DO FICHEIRO NN]
```

---

## Depois de cada bloco

Não aceite "feito" como prova. Duas verificações, ambas baratas:

- **No repositório:** apareceu um recibo novo em `supabase/migrations/` com nome UUID? O
  Lovable escreve-o depois de correr. Se não apareceu, provavelmente não correu.
- **Contra a base:** as sondagens de `../scorecard-v2-estado-antes.md` — os objectos desse
  bloco passaram de `PGRST205` a responder? É a prova que não depende de acreditar em
  ninguém.

## Depois dos oito

1. `supabase/tests/verify_scorecard_v2_deployment.sql` — só lê, tem de dar `PRESENTE` em
   tudo, incluindo `v_leader_weekly_scorecard.volume_source`.
2. `supabase/tests/leader_weekly_scorecard_test.sql` e
   `supabase/tests/scorecard_weighted_score_test.sql` — abrem transacção, afirmam, fazem
   `ROLLBACK`, e imprimem `ALL TESTS PASSED` na última linha.
3. Regenerar `src/integrations/supabase/types.ts`.
4. Tirar o `.skip` de `e2e/leader-scorecard-week.spec.ts`.

Os dois ficheiros de teste precisam de um papel que ignore o RLS, e o segundo desactiva
um trigger durante uma instrução (para semear uma semana aprovada sem simular um
aprovador) e volta a activá-lo. Se pedir ao Lovable para os correr, mande o mesmo aviso
de não reescrever.
