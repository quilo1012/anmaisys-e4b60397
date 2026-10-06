# Overtime asks — o que enviar ao Lovable

Um único bloco: `10-20260913120000_overtime_is_offered_before_it_is_worked.sql`.
É idempotente — pode correr duas vezes sem partir nada. Não depende dos blocos 01–09.

Cole o texto abaixo e o conteúdo do ficheiro no fim.

---

Corre este SQL na base, **exactamente como está**, sem alterar uma linha.

Não o reescrevas, não o reformates, não o "melhores", não juntes nem separes comandos.
Se achares que tem um problema, **não o corrijas** — diz-me qual é e para. Três coisas
neste SQL são deliberadas e parecem erros a quem lê depressa:

- `overtime_roster()`, `my_overtime_identity()` e `overtime_unlinked_names()` são
  `security definer` e devolvem **só** id, nome, departamento e turno. A tabela
  `employees` é lida apenas por admin, de propósito; estas funções existem para o
  gestor e o operador não precisarem dessa leitura. Não lhes acrescentes colunas.
- `can_manage_overtime()` passa por `has_action` com a lista base
  `{admin,manager,production_office_admin}`. O valor `supervisor` do enum está
  retirado e fica de fora. Não o acrescentes.
- `overtime_reliability()` **não** conta feriados/férias como falta, e conta
  `no_show` como falta mesmo que seja só uma. É a regra, não um esquecimento.

Quando terminares, responde só com:

1. terminou sem erro, ou a mensagem de erro exacta, completa;
2. a lista de tabelas, políticas e funções que criaste, como a base as tem agora;
3. se alteraste alguma coisa no SQL, e o quê.

Depois **regenera `src/integrations/supabase/types.ts`** para as três tabelas novas
aparecerem nos tipos. Não toques em mais nada.
