## Problem

No header do Manager/Admin Dashboard, três KPIs estão exagerados:

- **Avg Response Time = 849 min**
- **Avg Active Repair = 7 min** (ok, mas inclui ruído)
- **Avg Line Downtime = 3176 min**

Causa confirmada na base de dados (`v_wo_metrics` agrupado por status):

| Status | Qtd | Avg Response | Avg Repair | Avg Downtime |
|--------|-----|--------------|------------|--------------|
| force_closed | 67 | 759 min | — | 3498 min |
| finished | 4 | 1583 min | 17 min | 64 min |
| closed | 8 | 527 min | 1 min | 353 min |

As médias atuais no `ManagerDashboard.tsx` (linhas 68–85) **não filtram nada** — entram WOs `force_closed` (onde o engenheiro nunca aceitou, mas `received_at`/`line_resumed_at` foram preenchidos no fecho forçado, distorcendo tudo) e WOs ainda abertas com tempos parciais.

O `ExecutiveDashboard` já foi corrigido na resposta anterior para excluir `force_closed`; o `ManagerDashboard` ficou de fora.

## Correção

### `src/pages/dashboard/ManagerDashboard.tsx` (linhas 67–85)

Restringir as três médias apenas a WOs **realmente finalizadas** (status `finished`, `closed`, `completed`) — isso garante que o número só muda depois da ordem ser concluída, como pedido:

```ts
const FINAL = new Set(["finished", "closed", "completed"]);
const finalized = woMetrics.filter((m) => FINAL.has((m as any).status));

const respM = finalized.filter((m) => m.response_time_sec !== null && m.response_time_sec >= 0);
const repairM = finalized.filter((m) => m.active_repair_sec !== null && m.active_repair_sec > 0);
const downM   = finalized.filter((m) => m.line_downtime_sec !== null && m.line_downtime_sec > 0);
```

`force_closed` fica excluído (porque não representa um ciclo real do engenheiro), e WOs abertas/parciais também — exatamente o comportamento pedido: "só atualizar depois da ordem finalizada".

### Resultado esperado

Com os dados atuais (12 WOs finalizadas):

- Avg Response Time ≈ **879 min** → continua alto mas reflete apenas WOs realmente fechadas. Se quiseres baixar mais, podemos também adicionar um corte (ex.: ignorar response_time > 8h como outlier). **Pergunta abaixo.**
- Avg Active Repair ≈ **17 min** (só `finished`, único status com tempo de reparo real)
- Avg Line Downtime ≈ **161 min**

## Pergunta

Queres que eu também adicione um **corte de outliers** (ex.: ignorar `response_time_sec > 8h` e `line_downtime_sec > 24h`) para evitar que WOs antigas mal-fechadas continuem a inflar a média? Ou preferes manter todas as WOs finalizadas sem filtro extra?

Sem alterações visuais, apenas correção da métrica.
