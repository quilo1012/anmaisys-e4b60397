# Fix: caractere `¦` nos Predictive Alerts

## Causa-raiz

Em `src/hooks/usePredictiveAlerts.ts` (linhas 37–53), o hook agrupa work orders por máquina + descrição construindo uma chave concatenada com `|||`:

```ts
const key = `${wo.machine}|||${wo.description}`;
// ...
const [machine, problem] = key.split("|||");
```

Quando `wo.description` (ou `wo.machine`) já contém pipes — `|`, `||` ou `|||` — vindos de texto colado, importação, ou descrições do operador — o `split("|||")` retorna fragmentos errados e sobram pipes no início ou no meio de `problem`. Visualmente, `||` em fontes mais condensadas é renderizado como `¦` (broken bar U+00A6), produzindo o "¦ Conveyor Issues..." que você está vendo.

Não é problema de fonte nem de encoding — é um separador inseguro escolhido em código.

## O que vai ser feito

### 1. Trocar a estratégia de agrupamento (`src/hooks/usePredictiveAlerts.ts`)

Em vez de chave string com separador, armazenar `machine` e `problem` como campos do próprio bucket — eliminando o `split` e a possibilidade de colisão com pipes nos dados.

```ts
const groups: Record<string, {
  machine: string;
  problem: string;
  count: number;
  count7d: number;
  lastOccurrence: string;
}> = {};

recentWOs.forEach((wo) => {
  // separador seguro: caractere de controle improvável de ocorrer no texto
  const key = `${wo.machine}\u0000${wo.description}`;
  if (!groups[key]) {
    groups[key] = {
      machine: wo.machine,
      problem: wo.description,
      count: 0,
      count7d: 0,
      lastOccurrence: wo.created_at,
    };
  }
  groups[key].count++;
  // ... resto igual
});

Object.values(groups).forEach((val) => {
  if (val.count >= 3) {
    const isRecurring7d = val.count7d >= 3;
    predictive.push({
      machine: val.machine,
      problem: val.problem,
      // ...
    });
  }
});
```

### 2. Sanitização defensiva do texto exibido

Como salvaguarda extra (caso descrições reais contenham pipes propositais que ainda fiquem visualmente confusos), aplicar trim e colapsar pipes consecutivos antes de renderizar nos dois banners:

- `src/pages/dashboard/EngineerDashboard.tsx` (linha 642)
- `src/pages/dashboard/ControlCenterPage.tsx` (linha ~225)

Helper simples:
```ts
const cleanProblem = (s: string) =>
  s.replace(/\|{2,}/g, "|").replace(/^[\s|¦]+|[\s|¦]+$/g, "").trim();
```

E usar `{cleanProblem(a.problem)}` no JSX dos dois cards.

## Arquivos afetados

- `src/hooks/usePredictiveAlerts.ts` — refatorar agrupamento (remove `|||` e `split`)
- `src/pages/dashboard/EngineerDashboard.tsx` — sanitizar `a.problem` no banner
- `src/pages/dashboard/ControlCenterPage.tsx` — sanitizar `a.problem` no banner

## Resultado esperado

Os Predictive Alerts vão mostrar apenas o texto real da descrição da WO, sem `¦`, `||` ou pipes residuais no início/meio. O agrupamento por máquina+problema continua funcionando exatamente como antes, mas sem depender de um separador que pode colidir com o conteúdo do usuário.
