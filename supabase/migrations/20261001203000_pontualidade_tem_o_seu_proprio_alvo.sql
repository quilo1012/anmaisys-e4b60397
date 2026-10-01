-- Pontualidade passa a ter o seu proprio alvo, ao lado da assiduidade.
--
-- O scorecard semanal ja guardava `leader_lateness_incidents` e
-- `team_lateness_incidents`, mas contagens soltas: nada dizia quantos atrasos sao
-- demais, por isso o numero aparecia e nao significava nada. A assiduidade tinha
-- THR_AttendTarget desde o inicio; a pontualidade nao tinha par nenhum.
--
-- Uma contagem de atrasos nao se compara com um alvo sem denominador -- duas faltas
-- de pontualidade em cinco entradas e outra coisa que duas em cinquenta -- por isso o
-- que entra aqui e a FRACCAO de entradas sem atraso, espelhando exactamente
-- leader_attendance_pct / team_attendance_pct: mesmo tipo, mesma escala, mesmo CHECK.
-- As contagens ficam onde estao; medem o volume, estas medem a taxa.
--
-- Monitorado, NAO pontua, pela mesma razao que a assiduidade nao pontua -- e porque a
-- fonte (daily_allocations.arrived_late_at) esta hoje com 1 registo em 6.640. Um alvo
-- que pontuasse agora daria nota cheia a toda a gente por ninguem marcar nada, que e
-- a leitura exactamente ao contrario da verdade.

alter table leader_weekly_scorecard
  add column if not exists leader_punctuality_pct numeric(5,4)
    check (leader_punctuality_pct >= 0 and leader_punctuality_pct <= 1),
  add column if not exists team_punctuality_pct numeric(5,4)
    check (team_punctuality_pct >= 0 and team_punctuality_pct <= 1);

comment on column leader_weekly_scorecard.leader_punctuality_pct is
  'Fraccao das entradas do lider sem atraso na semana. Monitorado, NAO pontua -- par de leader_attendance_pct. Julgado contra THR_PunctualTarget.';
comment on column leader_weekly_scorecard.team_punctuality_pct is
  'Fraccao das entradas da equipa sem atraso na semana. Monitorado, NAO pontua -- par de team_attendance_pct.';

-- O limiar, com vigencia como todos os outros. Alterar e fechar esta linha e abrir a
-- seguinte, nunca um UPDATE do valor: isso reescreveria o julgamento de todas as
-- semanas ja registadas.
insert into leader_scorecard_threshold (name, value, pillar, valid_from, valid_to, note)
select 'THR_PunctualTarget', 0.980, 'Monitorado', date '2000-01-01', null,
       'Alvo de pontualidade: fraccao de entradas sem atraso. Monitorado, NAO pontua em nenhum RAG. Fonte: daily_allocations.arrived_late_at, hoje quase sempre vazio.'
where not exists (
  select 1 from leader_scorecard_threshold where name = 'THR_PunctualTarget' and valid_to is null
);

-- A view, alterada a partir da sua propria definicao em vez de reescrita por extenso.
--
-- Deliberado: uma copia da definicao inteira dentro de uma migracao congela um retrato
-- de um objecto que continua a mudar, e a proxima migracao que o reescreva por extenso
-- apaga em silencio o que esta tiver acrescentado. Assim a alteracao e cirurgica e
-- ABORTA em vez de adivinhar, se a ancora que espera ja nao estiver la.
--
-- As colunas novas vao para o FIM da lista para que CREATE OR REPLACE chegue: trocar a
-- ordem obrigaria a um DROP, e isso leva atras v_leader_weekly_scorecard_periods e os
-- rollups todos.
do $$
declare d text; antes int;
begin
  d := pg_get_viewdef('v_leader_weekly_scorecard'::regclass, true);

  antes := length(d);
  d := replace(d,
    'max(th.value) FILTER (WHERE th.name = ''THR_AttendTarget''::text) AS attend_target,',
    'max(th.value) FILTER (WHERE th.name = ''THR_AttendTarget''::text) AS attend_target,
            max(th.value) FILTER (WHERE th.name = ''THR_PunctualTarget''::text) AS punctual_target,');
  if length(d) = antes then
    raise exception 'v_leader_weekly_scorecard: nao encontrei THR_AttendTarget no lateral dos limiares';
  end if;

  antes := length(d);
  d := replace(d,
    '    s.volume_source' || chr(10) || '   FROM leader_weekly_scorecard s',
    '    s.volume_source,
    s.leader_punctuality_pct,
    s.team_punctuality_pct,
    s.leader_punctuality_pct IS NOT NULL AND s.leader_punctuality_pct < t.punctual_target AS leader_punctuality_below_target
   FROM leader_weekly_scorecard s');
  if length(d) = antes then
    raise exception 'v_leader_weekly_scorecard: nao encontrei o fim da lista de colunas (s.volume_source)';
  end if;

  execute 'CREATE OR REPLACE VIEW v_leader_weekly_scorecard AS ' || d;
end $$;
