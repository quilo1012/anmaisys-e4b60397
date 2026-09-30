/**
 * Para onde vão as horas em que a linha não anda.
 *
 * A fábrica regista cerca de 6 700 paragens por mês em `production_downtimes`, cada
 * uma com o seu motivo, vindas do iTouching ao minuto. Ninguém as via: o único sítio
 * onde o downtime aparecia era a coluna DT da grelha RAG, escrita à mão — 35 números
 * por mês contra 6 700 registos. O ecrã que usa este ficheiro existe para fechar essa
 * distância.
 *
 * O CONTRIBUTO DESTE FICHEIRO É A CLASSIFICAÇÃO.
 *
 * Todos os 6 700 registos entram na base com `category: 'Other'` — a coluna existe e
 * ninguém a preenche, por isso não separa nada. Sem separar, o ecrã diria só "2 638
 * horas paradas", que é um número verdadeiro e inútil: mistura o turno que não estava
 * planeado com a avaria do enchedor.
 *
 * Os motivos, esses, são consistentes e vêm de uma lista fechada do iTouching. São
 * eles que carregam a informação, e é a partir deles que se classifica aqui — no
 * cliente, sem tocar na base, e com o mapa declarado em vez de adivinhado.
 *
 * TRÊS BALDES, E A RAZÃO DE SEREM TRÊS
 *
 * Cada balde tem um dono diferente na fábrica, e é isso que os separa — não a
 * gravidade:
 *
 *   `fault`   — avaria. A linha devia estar a andar e não anda. É o que a manutenção
 *               combate, e é o que o módulo de ordens de trabalho já mede. Quatro por
 *               cento das horas.
 *   `process`  — preparação, mudança de SKU, enchimento de blender, limpeza, esperas
 *               por aprovação. Trabalho necessário que ninguém está a cronometrar.
 *               É o balde grande, e é onde está o dinheiro.
 *   `planned`  — pausas, mudança de turno, turno não planeado. É o calendário, não é
 *               uma perda. Aparece para as contas fecharem, e sai de todas as
 *               comparações entre linhas.
 *
 * MOTIVO DESCONHECIDO NÃO É `process`.
 *
 * Um motivo que não esteja no mapa vai para `unknown` e aparece no ecrã com o seu
 * nome, para ser classificado à mão depois. A alternativa — mandá-lo para um balde
 * por omissão — faria a categoria maior crescer sozinha sempre que o iTouching
 * ganhasse um código novo, sem ninguém dar por isso. Prefere-se uma linha por
 * classificar visível a uma percentagem errada invisível.
 */

export type StopBucket = "fault" | "process" | "planned" | "unknown";

/** Uma paragem, como vem de `production_downtimes`. */
export interface ProductionStop {
  id: string;
  occurred_date: string;
  shift: string | null;
  line: string | null;
  reason: string | null;
  duration_minutes: number | null;
  machine: string | null;
}

/**
 * Motivo → balde. Escrito em minúsculas, comparado em minúsculas.
 *
 * A lista vem do que a fábrica emitiu em Setembro de 2026. Acrescentar um motivo
 * aqui é uma linha; o teste `stopAnalysis.test.ts` garante que nenhum motivo
 * conhecido se perde pelo caminho.
 */
const REASON_BUCKETS: Record<string, StopBucket> = {
  // Avaria — a linha parou sem ser suposto.
  "alarm": "fault",
  "breakdown": "fault",
  "machine failure": "fault",
  "fault": "fault",

  // Processo — trabalho necessário, cronometrável, melhorável.
  "line preparation": "process",
  "filling blender/ blending": "process",
  "filling blender / blending": "process",
  "filling blender": "process",
  "brushing and cleaning": "process",
  "deep clean": "process",
  "drill cleaning": "process",
  "cleaning": "process",
  "awaiting sample approval": "process",
  "awaiting line approval": "process",
  "waiting": "process",
  "changeover": "process",
  "set up": "process",
  "setup": "process",

  // Planeado — o calendário.
  "breaks": "planned",
  "break": "planned",
  "no planned shift": "planned",
  "shift change over": "planned",
  "shift changeover": "planned",
  "planned maintenance": "planned",
  "training": "planned",
};

export function classifyStopReason(reason: string | null | undefined): StopBucket {
  if (!reason) return "unknown";
  return REASON_BUCKETS[reason.trim().toLowerCase()] ?? "unknown";
}

/** Rótulos e a ordem por que os baldes se leem. `planned` por último: não é perda. */
export const BUCKET_ORDER: StopBucket[] = ["process", "fault", "unknown", "planned"];

export const BUCKET_LABEL: Record<StopBucket, string> = {
  process: "Process",
  fault: "Faults",
  planned: "Planned",
  unknown: "Unclassified",
};

export const BUCKET_HINT: Record<StopBucket, string> = {
  process: "Changeover, blending, cleaning, waiting for approval — necessary work nobody is timing.",
  fault: "The line should have been running and was not. What maintenance fights.",
  planned: "Breaks, shift changes, unplanned shifts. The calendar, not a loss.",
  unknown: "Reasons not yet mapped to a bucket. Classify them so the percentages stay honest.",
};

export interface StopTotal {
  key: string;
  minutes: number;
  count: number;
  /** Fatia do total do conjunto que lhe deu origem, 0–100. */
  pct: number;
}

export interface StopBucketTotal extends StopTotal {
  bucket: StopBucket;
}

function pctOf(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/** Soma os minutos por balde. */
export function totalsByBucket(stops: readonly ProductionStop[]): StopBucketTotal[] {
  const acc = new Map<StopBucket, { minutes: number; count: number }>();
  for (const s of stops) {
    const b = classifyStopReason(s.reason);
    const cur = acc.get(b) ?? { minutes: 0, count: 0 };
    cur.minutes += Math.max(0, s.duration_minutes ?? 0);
    cur.count += 1;
    acc.set(b, cur);
  }
  const total = [...acc.values()].reduce((a, v) => a + v.minutes, 0);
  return BUCKET_ORDER.filter((b) => acc.has(b)).map((b) => {
    const v = acc.get(b)!;
    return { key: BUCKET_LABEL[b], bucket: b, minutes: v.minutes, count: v.count, pct: pctOf(v.minutes, total) };
  });
}

/**
 * Soma os minutos por motivo, do maior para o menor.
 *
 * `pct` é a fatia DENTRO do conjunto que entrou — se o chamador já tirou o balde
 * `planned`, as percentagens são do que sobra. É de propósito: a pergunta "que fatia
 * da minha perda é a preparação de linha" não deve ser diluída por pausas de almoço.
 */
export function totalsByReason(stops: readonly ProductionStop[]): (StopTotal & { bucket: StopBucket })[] {
  const acc = new Map<string, { minutes: number; count: number; bucket: StopBucket }>();
  for (const s of stops) {
    const key = s.reason?.trim() || "(no reason given)";
    const cur = acc.get(key) ?? { minutes: 0, count: 0, bucket: classifyStopReason(s.reason) };
    cur.minutes += Math.max(0, s.duration_minutes ?? 0);
    cur.count += 1;
    acc.set(key, cur);
  }
  const total = [...acc.values()].reduce((a, v) => a + v.minutes, 0);
  return [...acc.entries()]
    .map(([key, v]) => ({ key, minutes: v.minutes, count: v.count, bucket: v.bucket, pct: pctOf(v.minutes, total) }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** Soma os minutos por linha, do maior para o menor. */
export function totalsByLine(stops: readonly ProductionStop[]): StopTotal[] {
  const acc = new Map<string, { minutes: number; count: number }>();
  for (const s of stops) {
    const key = s.line?.trim() || "(no line)";
    const cur = acc.get(key) ?? { minutes: 0, count: 0 };
    cur.minutes += Math.max(0, s.duration_minutes ?? 0);
    cur.count += 1;
    acc.set(key, cur);
  }
  const total = [...acc.values()].reduce((a, v) => a + v.minutes, 0);
  return [...acc.entries()]
    .map(([key, v]) => ({ key, minutes: v.minutes, count: v.count, pct: pctOf(v.minutes, total) }))
    .sort((a, b) => b.minutes - a.minutes);
}

export interface LineReasonCell {
  line: string;
  reason: string;
  minutes: number;
  count: number;
}

/**
 * A matriz linha × motivo — onde se vê que a mesma mudança de SKU leva vinte minutos
 * numa linha e cinquenta noutra. É esta a tabela que faz o ecrã valer a pena.
 *
 * Devolve só os `topReasons` motivos maiores, porque uma matriz com trinta colunas
 * não se lê.
 */
export function lineReasonMatrix(
  stops: readonly ProductionStop[],
  topReasons = 6,
): { lines: string[]; reasons: string[]; cells: Map<string, LineReasonCell> } {
  const reasons = totalsByReason(stops).slice(0, topReasons).map((r) => r.key);
  const reasonSet = new Set(reasons);
  const lines = totalsByLine(stops).map((l) => l.key);
  const cells = new Map<string, LineReasonCell>();
  for (const s of stops) {
    const reason = s.reason?.trim() || "(no reason given)";
    if (!reasonSet.has(reason)) continue;
    const line = s.line?.trim() || "(no line)";
    const k = `${line}|${reason}`;
    const cur = cells.get(k) ?? { line, reason, minutes: 0, count: 0 };
    cur.minutes += Math.max(0, s.duration_minutes ?? 0);
    cur.count += 1;
    cells.set(k, cur);
  }
  return { lines, reasons, cells };
}

/**
 * Média de minutos por ocorrência, para um motivo, linha a linha.
 *
 * O total por linha diz quem parou mais; isto diz quem é mais lento de cada vez. São
 * perguntas diferentes: uma linha com o dobro das mudanças de SKU pára mais horas sem
 * ser pior a fazê-las.
 *
 * Linhas com menos de `minOccurrences` ocorrências ficam de fora — uma média de duas
 * paragens não distingue um método de um acaso.
 */
export function averagePerLine(
  stops: readonly ProductionStop[],
  reason: string,
  minOccurrences = 3,
): { line: string; avgMinutes: number; count: number; totalMinutes: number }[] {
  const target = reason.trim().toLowerCase();
  const acc = new Map<string, { minutes: number; count: number }>();
  for (const s of stops) {
    if ((s.reason?.trim().toLowerCase() ?? "") !== target) continue;
    const line = s.line?.trim() || "(no line)";
    const cur = acc.get(line) ?? { minutes: 0, count: 0 };
    cur.minutes += Math.max(0, s.duration_minutes ?? 0);
    cur.count += 1;
    acc.set(line, cur);
  }
  return [...acc.entries()]
    .filter(([, v]) => v.count >= minOccurrences)
    .map(([line, v]) => ({
      line,
      avgMinutes: Math.round((v.minutes / v.count) * 10) / 10,
      count: v.count,
      totalMinutes: v.minutes,
    }))
    .sort((a, b) => b.avgMinutes - a.avgMinutes);
}

/** Soma por dia, para a linha do tempo. Devolve ordenado por data crescente. */
export function totalsByDay(stops: readonly ProductionStop[]): { date: string; minutes: number; process: number; fault: number }[] {
  const acc = new Map<string, { minutes: number; process: number; fault: number }>();
  for (const s of stops) {
    const d = s.occurred_date;
    if (!d) continue;
    const cur = acc.get(d) ?? { minutes: 0, process: 0, fault: 0 };
    const m = Math.max(0, s.duration_minutes ?? 0);
    cur.minutes += m;
    const b = classifyStopReason(s.reason);
    if (b === "process") cur.process += m;
    if (b === "fault") cur.fault += m;
    acc.set(d, cur);
  }
  return [...acc.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
