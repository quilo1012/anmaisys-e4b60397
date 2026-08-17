# Estado da base ANTES de aplicar o scorecard v2

Medido em 2026-08-17 11:29 contra o PostgREST de `ybtrzqzliepknpzqdajx`, com a chave
pública do `.env`. Equivalente parcial do passo 1 de `scorecard-v2-apply.md`: o
verificador SQL consulta `pg_catalog` e `information_schema`, o que a chave pública não
permite, por isso cada objecto foi sondado pela via REST.

Como se lê: `PGRST205` = a relação não existe. `42703` = a tabela existe mas a coluna
não. `PGRST202` = a função não existe com aquela assinatura. `200`, ou um erro de
execução/permissão como `42501`, provam que o objecto existe.

## Controlos — fixam que a ligação e a chave estão boas

| Objecto | Tipo | Antes |
|---|---|---|
| `leader_score_weights` | tabela | PRESENTE |
| `downtime_corrections` | tabela | PRESENTE |
| `headcount_matrix` | tabela | PRESENTE |
| `v_line_live_status` | view | PRESENTE |
| `lines`, `line_leaders`, `quality_actions`, `rag_weekly_entries`, `leader_pins` | tabelas | PRESENTE |
| `leader_self_scorecard(_pin,_from,_to)` | função | PRESENTE (401/42501 — executou e recusou por permissão) |

## O módulo — nada disto existe

| Objecto | Tipo | Antes |
|---|---|---|
| `leader_scorecard_thresholds` (v1) | tabela | AUSENTE (PGRST205) |
| `leader_weekly_scorecard` | tabela | AUSENTE (PGRST205) |
| `leader_line_assignment` | tabela | AUSENTE (PGRST205) |
| `leader_scorecard_threshold` | tabela | AUSENTE (PGRST205) |
| `v_leader_weekly_scorecard` | view | AUSENTE (PGRST205) |
| `v_leader_weekly_scorecard_periods` | view | AUSENTE (PGRST205) |
| `v_scorecard_rollup_leader` | view | AUSENTE (PGRST205) |
| `leader_weekly_scorecard.volume_source` | coluna | AUSENTE (a tabela não existe) |
| `v_leader_weekly_scorecard.volume_source` | coluna | AUSENTE (a view não existe) |
| `quality_options.points` | coluna | AUSENTE (42703 — a tabela existe, a coluna não) |
| `quality_actions.domain` | coluna | AUSENTE (42703) |
| `quality_actions.safety_kind` | coluna | AUSENTE (42703) |
| `scorecard_derived_volume(uuid,date)` | função | AUSENTE (PGRST202) |
| `scorecard_week_board(date)` | função | AUSENTE (PGRST202) |
| `scorecard_safety_counts(uuid,text,date)` | função | AUSENTE (PGRST202) |

## O que esta medição NÃO cobre

O PostgREST não expõe o catálogo, portanto três coisas ficaram por verificar e só o
verificador SQL as apanha, depois de aplicar:

- os tipos ENUM (`scorecard_volume_source`, `scorecard_check_status`,
  `scorecard_downtime_reason`, `scorecard_capa_status`, `action_domain`, `safety_kind`)
- os triggers (`trg_scorecard_require_capa`, `trg_scorecard_weights_total_100`,
  `trg_scorecard_version_weights`)
- as políticas RLS

## Conclusão

Nenhuma parte do módulo do scorecard chegou à base. A fronteira descrita em
`scorecard-v2-apply.md` confirma-se: tudo o que é anterior a 14/08 está presente, tudo
o que vem das oito migrações pendentes está ausente. Os controlos respondem, portanto
os ausentes são ausência real e não falta de autorização.
