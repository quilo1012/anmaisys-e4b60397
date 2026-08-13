import type { PmSchedule } from "@/hooks/usePreventiveMaintenance";

/**
 * O que as ordens de manutenção dizem sobre o intervalo de PM de cada activo.
 *
 * Vive aqui, e não dentro da página, porque cada uma destas decisões estava a ser
 * tomada dentro de um `useMemo` de 80 linhas onde nenhuma delas podia ser testada — e
 * a que estava errada só se via somando 23 linhas da tabela e reparando que todas
 * imprimiam o mesmo número.
 */

/** Nada mais curto do que isto é um plano preventivo — é uma avaria à espera. */
export const PM_FLOOR_DAYS = 7;
/** Acima disto, o plano deixa de ser um plano e passa a ser um lembrete anual. */
export const PM_CEILING_DAYS = 180;
/** Serviço antes da falha média, não em cima dela. */
export const MTBF_FRACTION = 0.7;
/** Uma falha não tem "tempo entre falhas". */
export const MIN_FAILURES = 2;
/**
 * Quanto é que o intervalo actual pode afastar-se do recomendado antes de valer a
 * pena mexer-lhe. Um plano de 30 dias contra uma recomendação de 32 está calibrado:
 * mandar alguém alterá-lo é dar trabalho para não mudar nada.
 */
export const CALIBRATION_TOLERANCE = 0.15;

const DAY_MS = 86_400_000;

/**
 * O MTBF, medido contra a janela observada e não contra o vão entre a primeira e a
 * última falha.
 *
 * Era `span(primeira..última) / (n-1)`, e é essa a raiz de a tabela inteira imprimir
 * "7d". Esse estimador deita fora a janela de observação: subestima o MTBF por um
 * factor de n/(n-1) sempre, e desfaz-se em n=2 — duas falhas com uma hora de
 * intervalo dentro de 90 dias davam MTBF de 0,05 dias. Com 0,7 × MTBF a cair abaixo
 * do piso de 7 dias em dez das onze chaves com evidência, o clamp levantava todas
 * para 7 e a coluna "Recommended" passou a ser uma constante com ar de cálculo.
 *
 * A taxa de falhas é λ = falhas / tempo observado, e o MTBF é 1/λ. Line 4, com 73
 * ordens em 90 dias, tem MTBF de 1,2 dias — e continua abaixo do piso, o que é a
 * resposta verdadeira. Capsules Machine 1, com 4, tem 22,5 dias e passa a ter um
 * intervalo real de 16 dias, que antes desaparecia no mesmo "7d".
 */
export function mtbfDays(failures: number, windowDays: number): number | null {
  if (failures < MIN_FAILURES || windowDays <= 0) return null;
  return windowDays / failures;
}

export type AssetKind =
  /** Um nome de linha que soma várias unidades servíveis. Não tem intervalo próprio. */
  | "aggregate"
  /** Uma unidade que alguém pode ir manutencionar. */
  | "unit"
  /** A ordem nomeou algo que não está no registo de activos. */
  | "unknown";

/**
 * Que tipo de activo é cada nome que aparece no campo `machine` das ordens.
 *
 * A versão anterior perguntava só "está na tabela `lines`?", e as duas tabelas não são
 * duas taxonomias limpas: `lines` contém `Capsules Machine 1` e `Capsules Machine 2`,
 * que são máquinas; `machines` contém `Line 1`..`Line 4`, que são linhas. O resultado
 * era errado nos dois sentidos — `Capsules Machine 1` recusava recomendação por ser
 * "linha", e `Line 6A` recebia uma por não estar em `lines`.
 *
 * O que resolve é o `machines.line_id`, que diz o que está por baixo de quê. Uma linha
 * cuja única máquina tem o seu próprio nome é uma unidade: `Line 4` é servida como um
 * todo, e um intervalo para ela quer dizer alguma coisa. Uma linha com `Line 5A` e
 * `Line 5B` por baixo é um agregado, e o intervalo entre as suas ordens é a soma de
 * duas máquinas.
 */
export function buildAssetIndex(
  lines: { id: string; name: string }[] | undefined,
  machines: { name: string; line_id: string | null }[] | undefined,
): Map<string, AssetKind> {
  const index = new Map<string, AssetKind>();
  const byLine = new Map<string, string[]>();
  for (const m of machines ?? []) {
    if (!m.line_id) continue;
    const arr = byLine.get(m.line_id) ?? [];
    arr.push(m.name.trim());
    byLine.set(m.line_id, arr);
  }

  // As máquinas primeiro: uma linha que seja agregado sobrepõe-se a seguir.
  for (const m of machines ?? []) {
    const key = m.name.trim().toLowerCase();
    if (key) index.set(key, "unit");
  }

  for (const l of lines ?? []) {
    const key = l.name.trim().toLowerCase();
    if (!key) continue;
    const under = byLine.get(l.id) ?? [];
    const isSelf = under.length === 1 && under[0].toLowerCase() === key;
    // Sem nada por baixo também é agregado: a linha existe, as suas máquinas não
    // estão registadas, e nada garante que as ordens dela sejam de uma só unidade.
    index.set(key, isSelf ? "unit" : "aggregate");
  }

  return index;
}

export function assetKind(name: string, index: Map<string, AssetKind>): AssetKind {
  return index.get(name.trim().toLowerCase()) ?? "unknown";
}

export type Recommendation =
  /** Um intervalo defensável, dentro do piso e do tecto. */
  | { kind: "interval"; days: number }
  /** 0,7 × MTBF acima do tecto — o plano fica no tecto, e isso diz-se. */
  | { kind: "capped"; days: number; uncapped: number }
  /** Falha mais depressa do que qualquer ciclo preventivo apanha. */
  | { kind: "chronic"; wouldBe: number }
  /** Menos de duas falhas na janela: não há tempo entre falhas para medir. */
  | { kind: "sparse" };

/**
 * O intervalo que a evidência sustenta — ou a razão de não haver nenhum.
 *
 * O clamp anterior devolvia sempre um número, e um número não tem como dizer que foi
 * inventado. `Math.max(7, ...)` sobre um activo que falha de 30 em 30 horas devolve
 * "7d" com o mesmo ar de certeza que um activo que falha de 45 em 45 dias — e a
 * página imprimia os dois na mesma coluna, com o mesmo peso. Um activo abaixo do piso
 * não precisa de um intervalo mais curto, precisa que alguém veja porque é que ele
 * falha: é um `chronic`, e a tabela manda-o para o cartão de trabalho recorrente em
 * vez de lhe oferecer um plano que não o vai salvar.
 */
export function recommendInterval(failures: number, windowDays: number): Recommendation {
  const mtbf = mtbfDays(failures, windowDays);
  if (mtbf === null) return { kind: "sparse" };
  const raw = mtbf * MTBF_FRACTION;
  if (raw < PM_FLOOR_DAYS) return { kind: "chronic", wouldBe: Math.round(raw * 10) / 10 };
  if (raw > PM_CEILING_DAYS) return { kind: "capped", days: PM_CEILING_DAYS, uncapped: Math.round(raw) };
  return { kind: "interval", days: Math.round(raw) };
}

export type Verdict =
  /** Falha mais depressa do que qualquer PM. Precisa de causa raiz, não de intervalo. */
  | "chronic"
  /** Há intervalo medido e não há plano nenhum. */
  | "plan"
  /** Há plano, e o intervalo medido diz outra coisa. */
  | "adjust"
  /** Há plano, e a evidência concorda com ele. */
  | "calibrated"
  /** O nome é uma linha inteira: não tem intervalo próprio. */
  | "aggregate"
  /** Evidência a menos para dizer o que quer que seja. */
  | "sparse";

export function verdictOf(
  kind: AssetKind,
  rec: Recommendation,
  currentInterval: number | null,
): Verdict {
  if (kind === "aggregate") return "aggregate";
  if (rec.kind === "sparse") return "sparse";
  if (rec.kind === "chronic") return "chronic";
  if (currentInterval === null) return "plan";
  const drift = Math.abs(rec.days - currentInterval) / currentInterval;
  return drift <= CALIBRATION_TOLERANCE ? "calibrated" : "adjust";
}

export interface PmAssetInput {
  machine: string | null;
  created_at: string;
  wo_type?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  description?: string | null;
}

export interface PmAssetRow {
  asset: string;
  kind: AssetKind;
  failures: number;
  mtbfDays: number | null;
  mttrHours: number | null;
  /** Quantas das falhas trazem início e fim, que é de onde sai o MTTR. */
  repairSample: number;
  currentInterval: number | null;
  scheduleId: string | null;
  recommendation: Recommendation;
  verdict: Verdict;
  topIssues: { description: string; count: number }[];
}

export interface PmCoverage {
  /** Ordens na janela, depois de tirar as preventivas e as de armazém. */
  considered: number;
  /** Dessas, as que nomeiam um activo — as únicas que esta página consegue ler. */
  named: number;
  /** Ordens deixadas de fora por não nomearem activo nenhum. */
  unnamed: number;
  /** Ordens excluídas por não serem avarias: preventivas e serviços de armazém. */
  excluded: number;
  /** Reparações com início e fim, que é a amostra do MTTR. */
  timed: number;
}

/**
 * Reparações impossíveis: o relógio andou para trás, ou a ordem ficou aberta um fim
 * de semana inteiro sem ninguém lá estar. Uma média de MTTR não sobrevive a nenhuma
 * das duas.
 */
const MAX_REPAIR_HOURS = 72;

/**
 * Ordens que não são avarias e por isso não contam para o MTBF de ninguém.
 *
 * `preventive` já estava excluída — contar o trabalho planeado faria uma máquina
 * parecer pior por ser bem tratada. `warehouse_service` faltava: um pedido de
 * armazém pode trazer um nome de activo no mesmo campo (o `useCreateWorkOrder`
 * guarda-o de propósito) e entrava na conta como se a máquina tivesse avariado.
 *
 * Exportado porque a regra tem de ser uma só. O cartão de trabalho recorrente tinha
 * a sua própria versão, com `preventive` e sem `warehouse_service`, e as duas contas
 * apareciam lado a lado no mesmo ecrã: "Line 4 · 74 orders" por cima de uma linha que
 * dizia ter lido 109 de 111 com 2 excluídas.
 */
const NON_FAILURE_TYPES = new Set(["preventive", "warehouse_service"]);

/** Esta ordem é uma avaria — algo parou e alguém chamou? */
export function isFailureOrder(woType: string | null | undefined): boolean {
  return !NON_FAILURE_TYPES.has(String(woType ?? ""));
}

export function buildPmAssetRows(
  workOrders: PmAssetInput[] | undefined,
  schedules: PmSchedule[] | undefined,
  opts: { from: Date; to: Date; assetIndex: Map<string, AssetKind> },
): { rows: PmAssetRow[]; coverage: PmCoverage; windowDays: number } {
  const from = opts.from.getTime();
  const to = opts.to.getTime();
  const windowDays = Math.max((to - from) / DAY_MS, 0);

  const coverage: PmCoverage = { considered: 0, named: 0, unnamed: 0, excluded: 0, timed: 0 };
  const byAsset = new Map<string, PmAssetInput[]>();

  for (const w of workOrders ?? []) {
    const at = new Date(w.created_at).getTime();
    if (!Number.isFinite(at) || at < from || at > to) continue;
    if (!isFailureOrder(w.wo_type)) { coverage.excluded += 1; continue; }
    coverage.considered += 1;
    const asset = (w.machine ?? "").trim();
    if (!asset) { coverage.unnamed += 1; continue; }
    coverage.named += 1;
    if (w.started_at && w.finished_at) coverage.timed += 1;
    const arr = byAsset.get(asset) ?? [];
    arr.push(w);
    byAsset.set(asset, arr);
  }

  // O plano activo com o intervalo mais curto é o que manda: é o que chega primeiro.
  const pmByAsset = new Map<string, { id: string; interval: number }>();
  for (const s of schedules ?? []) {
    const key = (s.machine ?? "").trim();
    if (!key || !s.active) continue;
    const cur = pmByAsset.get(key);
    if (!cur || s.interval_days < cur.interval) pmByAsset.set(key, { id: s.id, interval: s.interval_days });
  }

  const rows: PmAssetRow[] = [];
  byAsset.forEach((orders, asset) => {
    const failures = orders.length;

    const repairs = orders
      .filter((w) => w.started_at && w.finished_at)
      .map((w) => (new Date(w.finished_at!).getTime() - new Date(w.started_at!).getTime()) / 3_600_000)
      .filter((h) => h > 0 && h < MAX_REPAIR_HOURS);
    const mttrHours = repairs.length ? repairs.reduce((a, b) => a + b, 0) / repairs.length : null;

    const issues = new Map<string, number>();
    for (const w of orders) {
      const key = (w.description || "—").trim().slice(0, 80);
      issues.set(key, (issues.get(key) ?? 0) + 1);
    }
    const topIssues = Array.from(issues.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([description, count]) => ({ description, count }));

    const kind = assetKind(asset, opts.assetIndex);
    const pm = pmByAsset.get(asset) ?? null;
    const currentInterval = pm?.interval ?? null;
    const recommendation = recommendInterval(failures, windowDays);

    rows.push({
      asset,
      kind,
      failures,
      mtbfDays: mtbfDays(failures, windowDays),
      mttrHours,
      repairSample: repairs.length,
      currentInterval,
      scheduleId: pm?.id ?? null,
      recommendation,
      verdict: verdictOf(kind, recommendation, currentInterval),
      topIssues,
    });
  });

  return { rows: rows.sort(compareRows), coverage, windowDays };
}

/**
 * A ordem por que se lê o ecrã: o que ninguém está a tratar primeiro, o que já está
 * calibrado no fim. Dentro do mesmo veredicto manda quem falha mais.
 */
const VERDICT_ORDER: Record<Verdict, number> = {
  chronic: 0, plan: 1, adjust: 2, calibrated: 3, aggregate: 4, sparse: 5,
};

export function compareRows(a: PmAssetRow, b: PmAssetRow): number {
  const d = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
  return d !== 0 ? d : b.failures - a.failures;
}
