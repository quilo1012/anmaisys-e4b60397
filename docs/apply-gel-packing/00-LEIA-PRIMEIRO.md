# Gel Machine → Gel Packing

## O que se vê

O RAG Weekly mostra **Gel Packing**. O Production Control e o Performance mostram
**GEL MACHINE**, com "Gel Packing" em letra pequena por baixo, `NO PLAN` e `0 target`,
mesmo com 1.455 feitos.

## Causa (medida em produção a 30/10/2026, só contagens, sessão admin no Chrome)

Não é um texto mal escrito no ecrã. Há **três linhas diferentes** na tabela `lines`, com
ids diferentes:

| linha | criada | o que lá está gravado |
|---|---|---|
| `GEL Line` | 19/04 | 63 sessões (29/06–22/10), 26 linhas do RAG |
| `Gel Machine` | **28/09** | 13 sessões (28/09–30/10), 1 linha do RAG (plano 0) |
| `Gel Packing` | 22/10 | 1 sessão (27/10), 1 linha do RAG (plano 1000) |

O tablet e o iTouching gravam a linha **pelo nome da linha a que a sua ligação aponta**:

- **Tablet** — a conta `operator_line_accounts` com o rótulo *Gel Machine* aponta para a
  linha `Gel Machine`. É esta conta que o tablet do packing usa: o lançamento de hoje
  ("Gel endurance energy variety 6×60 G", 1.455) está lá. **É esta a ligação errada.**
  O plano do RAG está em `Gel Packing`, as sessões estão em `Gel Machine`, e o
  Performance cruza os dois pelo nome: sem plano → `NO PLAN`.
- **iTouching** — a máquina iTouching *Gel Packing* (nunca reportou estado; a fila mostra
  BERBERINE) está ligada à linha `Gel Machine`. É ela que põe "Gel Packing" por baixo do
  título do cartão. A máquina iTouching *GEL Line* (a que reporta, e corre
  GEL ENDURANCE ENERGY) esteve ligada a `Gel Machine` de 06/10 a 24/10 e escreveu 260
  paragens e 580 estados com esse nome; desde 24/10 escreve em `Gel Packing`.

Houve uma tentativa no próprio dia 27/10: às 17:44 abriu-se uma sessão em `Gel Machine`
e às 17:50 outra em `Gel Packing` (a conta *Gel Packing*, criada a 22/10), e o item foi
para a segunda. A primeira ficou vazia — e o tablet voltou à conta *Gel Machine* no dia
seguinte.

## O que a correcção faz (`2-CORRIGIR.sql`)

Uma transacção, com cópia linha a linha em `public._bkp_gel_machine_20261030` (RLS
ligado, sem acesso de anon/authenticated):

1. A conta de tablet *Gel Machine* passa a apontar para `Gel Packing`. **O rótulo não
   muda** — é o nome com que o operador entra no tablet.
2. A máquina iTouching *Gel Packing* passa para a linha `Gel Packing` e fica **inactiva**
   (não apagada). Activa, o sync somava a fila dela à do Gel Packing.
3. As 13 sessões passam para `Gel Packing`. Itens, lotes, quantidades, horas, turnos,
   líder e blender seguem pelo id da sessão — não são tocados. A sessão vazia de 27/10
   (sem itens, blender nem acções) é removida, porque o Gel Packing já tem a desse turno.
   Se alguma sessão duplicada tiver conteúdo, o script pára e não muda nada.
4. `sku_production_history` (derivada) passa para `Gel Packing`; a linha de 27/10 que
   repete a do Gel Packing é removida (copiada).
5. RAG (1 linha) e `production_targets` (2) passam para `Gel Packing`, com paragem se
   houver colisão.
6. Paragens (260) e estados iTouching (580) gravados como `Gel Machine` passam para
   `Gel Packing`.
7. O actual do RAG dos dias movidos é recalculado (o trigger só corre quando a linha do
   RAG é escrita).
8. A linha `Gel Machine` fica **inactiva**, não apagada.

No fim, o script conta o que ainda aponta para `Gel Machine` nas tabelas que corrigiu;
se não for zero, desfaz tudo.

**Não mexe** em: `GEL Line` e os seus dados; as 2 ordens de manutenção (#1317, #1385)
cuja máquina é a *Gel Machine* física; a área do Headcount "Gel Machine" (está ligada à
`GEL Line`); `machines` ("Gel Machine" e "Gel Packing" são as duas máquinas da GEL Line).

## Ordem

1. `1-DIAGNOSTICO.sql` — só leitura. Confirmar as contagens acima e ver a lista de
   triggers (secção 5). Se aparecer um trigger que notifica ou chama uma edge function
   numa destas tabelas, parar.
2. `3-VERIFICAR.sql` — só leitura. Guardar o resultado (a última query dá erro antes da
   correcção: a cópia ainda não existe).
3. `2-CORRIGIR.sql` — escreve. Ler os `NOTICE`.
4. `3-VERIFICAR.sql` — a coluna `gel_machine` tem de dar 0 em tudo e o total de produção
   tem de ser o mesmo do passo 2.
5. Recarregar o tablet do Gel Packing. A linha guardada no tablet ("Gel Machine") deixa
   de estar na lista da conta e o ecrã escolhe `Gel Packing` sozinho.

Para desfazer: `4-REVERTER.sql`.

## Testado

Numa base Postgres 16 local com as tabelas afectadas, os unique indexes reais e o
trigger do actual do RAG, com dados que reproduzem as colisões de produção:
correcção → verificação (tudo a 0, total de produção igual) → segunda execução recusada →
reversão → estado **igual** ao de partida (diff vazio). A colisão com conteúdo pára o
script sem deixar nada escrito.
