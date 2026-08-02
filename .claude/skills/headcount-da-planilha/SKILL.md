---
name: headcount-da-planilha
description: Preenche a alocação diária do Production Headcount no PMSYSTEM a partir da planilha "Production Headcount August.xlsx" (ou de uma foto/captura de uma aba de dia dela), casando os nomes da folha com a tabela employees e gravando em daily_allocations. Use sempre que o utilizador enviar uma foto, captura ou aba da planilha do headcount, ou disser coisas como "preenche o headcount de amanhã", "põe o dia 04/08 igual à foto", "coloca essas posições no app", "semeia a alocação", ou mencionar as colunas da folha (Line 1..Line 6, Pill line, Hygiene, Gel Room, Runner, WH team, Absence, Holidays, Overtime staff). Use também quando pedirem para conferir se a alocação do sistema bate com a planilha, mesmo sem pedirem para gravar.
---

# Preencher o headcount a partir da planilha

A planilha é a fonte da verdade da fábrica; o sistema é a cópia. Esta skill passa uma
aba de dia da planilha para `daily_allocations`, que é a tabela que a página publicada
`/dashboard/headcount` lê.

O risco central não é falhar em gravar — é **gravar a pessoa errada numa linha**. A
folha usa primeiros nomes ("Vagner", "Luis F", "MURILO") e o sistema tem nomes
completos, com homónimos reais: quatro pessoas chamadas Lucas, três Ezaquiel, dois
Andre. Um nome adivinhado parece certo no ecrã e ninguém o apanha. Por isso a regra
que atravessa tudo aqui: **só grava quem tem correspondência única; o resto é
reportado, nunca inferido.**

## Fluxo

### 1. Transcrever a folha, coluna a coluna

Lê a aba do dia (o nome da aba é a data, ex. `03.08.2026`). Duas faixas de colunas:

- **Produção** — Line 1, Line 2, Line 3, Line 4, Line 5 (A&B), Line 6 (A&B),
  Pill line, Tablet line, Hygiene, Quality, Gel Room, Runner
- **Apoio e estados** — Lab, Assembly, WH team, Office, Maintenance, Blender Team,
  **Absence**, **Holidays**, **Overtime staff**

**Conta os nomes; não confies na linha "Total".** As fórmulas de total da folha ficam
desatualizadas — numa aba real a Line 1 tinha 5 nomes e o total dizia 4. Se o total
divergir do número de nomes, reporta a divergência e segue pelos nomes.

O mapeamento das colunas da folha para as áreas do sistema está em
`references/colunas.md`. Lê-o antes de gravar: os nomes não coincidem todos (a folha
diz "Pill line", o sistema tem "Capsules Machine 1" e "2") e há uma coluna que não é
um sítio nenhum.

### 2. Puxar o roster real

```sql
select id, full_name, employee_ref, department, shift_group
from employees where active order by full_name;
```

Não filtres por `shift_group` à partida. Gente que a folha põe no turno Day aparece no
sistema noutro grupo, e filtrar cedo transforma uma pessoa existente num "não
encontrado".

### 3. Casar os nomes

Usa `scripts/match_names.py` em vez de o fazer a olho — 87 nomes contra 193 pessoas é
onde o olho falha. Ele classifica cada nome em três baldes: **único**, **ambíguo**
(mais de um candidato) e **sem registo**.

Repara nas quase-correspondências antes de as declarares em falta: a folha escreve
*Ezequiel* e o sistema tem três *Ezaquiel*; *Felipe* pode ser *Filipi*. Menciona-as
como possíveis, não as resolvas sozinho.

Um ambíguo pode ficar resolvido pelo contexto da própria folha: se "Sergio" está em
Assembly e "Sergio Junior" aparece noutra coluna, o de Assembly é o outro Sergio.
Explica o raciocínio quando usares isto — é uma inferência, e o utilizador tem de a
poder recusar.

### 4. Reportar antes de gravar

Mostra sempre, antes de tocar na base:

- quantos nomes únicos, ambíguos e sem registo (com os nomes, por coluna)
- **conflitos**: o mesmo nome em duas colunas. Numa aba real "Pedro" estava na Line 6
  e em Holidays — são duas pessoas diferentes ou um erro da folha, e ninguém pode
  estar na linha e de férias no mesmo dia. Deixa-o de fora e diz porquê.

Nomes sem registo **não se criam**. Criar um empregado mete uma pessoa no roster
permanente, que passa a contar no headcount todos os dias — é uma decisão do
utilizador, não um efeito lateral de preencher um dia.

### 5. Gravar

O dia é substituído: apaga a alocação existente dessa data e grava a folha. O que lá
estava veio de outro lado e a folha é a fonte.

```sql
delete from daily_allocations where on_date = '<data>';
insert into daily_allocations (on_date, shift, employee_id, area_id, status) values ...
```

Restrições da tabela, que rejeitam a escrita inteira se forem violadas:

- `shift` só aceita **`Day` | `Night` | `Weekend`**. Não há turno de armazém: mapeia
  `Warehouse Day` → `Day` e `Warehouse Weekend` → `Weekend`, e **diz que o fizeste** —
  são 18 pessoas que perdem o turno próprio.
- `status` só aceita **`assigned` | `absence` | `holiday` | `overtime`**.
- Único por `(on_date, shift, employee_id)`.

Faz o `delete` e o `insert` na mesma chamada. São uma transação: se o insert falhar por
uma restrição, o delete é revertido e o dia fica intacto em vez de vazio.

### 6. Verificar e contar a verdade

Relê o que ficou gravado, agrupado por área, e compara com a folha:

```sql
select coalesce(h.name,'(sem area)') as area, count(*) as n,
       string_agg(e.full_name, ', ' order by e.full_name) as quem
from daily_allocations d
join employees e on e.id = d.employee_id
left join headcount_areas h on h.id = d.area_id
where d.on_date = '<data>' group by 1 order by 1;
```

No relatório final diz **o que não entrou e porquê**, coluna a coluna. Um board com a
Hygiene vazia não é um erro da skill se as cinco pessoas da Hygiene não existem no
sistema — mas o utilizador tem de saber isso, senão vai olhar para o ecrã e pensar que
falhou.

## O que nunca fazer

- **Escolher entre homónimos.** "Lucas" com quatro candidatos fica de fora, mesmo que
  isso deixe a Maintenance a menos uma pessoa.
- **Tratar "Overtime staff" como área.** Essas pessoas estão na linha delas *e* nessa
  coluna; alocá-las à "Overtime" tirava-as do sítio onde estão a trabalhar.
- **Dizer que está feito sem dizer o que ficou de fora.** Preencher 38 de 87 nomes é um
  resultado legítimo; apresentá-lo como "preenchido igual à foto" não é.
