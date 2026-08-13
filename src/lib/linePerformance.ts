/**
 * O que uma linha fez, contra o alvo do turno e contra o relógio.
 *
 * AQUI ESTEVE O RITMO, e vale a pena dizer porque saiu, para não voltar.
 *
 * O ritmo comparava a produção com o que a linha devia ter feito segundo a taxa
 * padrão do SKU — `sku_products.target_per_hour` — vezes o tempo trabalhado.
 * Existia para uma coisa só, e boa: a meio de um turno de doze horas, comparar
 * o feito com o plano do dia inteiro pinta de vermelho toda a fábrica por causa
 * das sete horas que ainda ninguém trabalhou, e uma fábrica inteira vermelha é
 * uma fábrica que deixa de olhar para o painel.
 *
 * Morreu por duas razões:
 *
 * 1. A taxa não existe. Mais de duzentos SKUs activos têm `target_per_hour` a
 *    zero ou nulo, e os restantes partilham cinco valores entre si — são valores
 *    por defeito da classe da linha, não padrões do produto. Para a maior parte
 *    do que se faz nesta fábrica o ritmo não era calculável, e o cartão dizia
 *    "SKU has no standard rate" em âmbar a alguém que não tinha como o resolver.
 *
 * 2. Era invisível. Quando os cartões passaram a imprimir a fatia do alvo, o
 *    ritmo ficou a decidir só a COR: o painel mostrava 9%, luz verde, e uma
 *    legenda a dizer que verde era ≥95%. Um número que decide o que a fábrica vê
 *    e que não está escrito em lado nenhum não se pode conferir nem contestar.
 *
 * O RELÓGIO faz o mesmo trabalho com o que está na parede. Quanto do turno já
 * passou é uma percentagem que qualquer pessoa calcula de cabeça; quanto do alvo
 * já está feito é a divisão dos dois números que o cartão já imprime. A cor é a
 * distância entre as duas. Não precisa de base de dados nenhuma, funciona para
 * todos os SKUs, e as duas parcelas ficam ambas no ecrã ao lado da cor que
 * produzem.
 *
 * O que o relógio NÃO faz, e o ritmo tentava: descontar paragens planeadas.
 * Uma Deep Clean de uma hora conta como tempo passado. O ritmo também a contava
 * — `planned_stop_minutes()` lê `production_downtimes`, que não tem uma linha
 * desde 29/07 — por isso não se perdeu precisão nenhuma na troca; perdeu-se uma
 * intenção que nunca chegou a funcionar. O ecrã diz isto por palavras em vez de
 * o deixar descobrir.
 *
 * Nada aqui lê contagens do iTouching: `production_items.intouch_qty` esteve
 * sempre NULL em toda a história da tabela, e a sincronização que a encheria
 * está desligada por decisão de um admin (apagava linhas do operador). O que se
 * mede é o que uma pessoa escreveu, e o chamador mostra há quanto tempo o
 * escreveu.
 */

export type ScoreBand = "GO" | "HOLD" | "STOP";

/**
 * Quantos pontos percentuais uma linha pode estar atrás do relógio antes de
 * passar de âmbar a vermelho.
 *
 * Em pontos e não em proporção, e a diferença importa nas pontas. Uma regra
 * proporcional ("95% do devido a esta hora") é histérica no início do turno,
 * onde dividir por um tempo quase nulo faz uma peça valer centenas de por
 * cento — era exactamente para isso que o ritmo precisava de um WARMUP de
 * quinze minutos, e com pontos esse caso especial deixa de ser preciso: aos 5%
 * de turno decorrido ninguém consegue estar quinze pontos atrás. Ao fim do
 * turno é o contrário, e também está certo: a 90% do tempo, quinze pontos atrás
 * é uma linha que já não recupera, e vermelho é a palavra para isso.
 */
export const BEHIND_TOLERANCE_PTS = 15;

const MS_PER_MIN = 60_000;

/**
 * Quanto do turno já passou, de 0 a 100.
 *
 * Fechado nas duas pontas: antes de abrir é 0, depois de fechar é 100. Um ecrã
 * de parede fica ligado a noite inteira e ninguém o vai fechar às 18:00 — a
 * partir daí o turno inteiro era devido e é assim que fica.
 *
 * Atravessa a meia-noite sem saber que o faz, porque recebe os dois instantes
 * já resolvidos por `shifts.ts` (dia 06:00–18:00, noite 18:00–06:00 do dia
 * seguinte, hora de Londres).
 */
export function shiftClockPct(shiftStart: Date, shiftEnd: Date, now: Date): number {
  const total = shiftEnd.getTime() - shiftStart.getTime();
  // Um turno sem duração não divide. Só pode ser um erro de configuração, e
  // "tudo era devido" é a leitura que não inventa folga nenhuma.
  if (total <= 0) return 100;
  const elapsed = now.getTime() - shiftStart.getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

/**
 * Verde, âmbar ou vermelho, num sítio só.
 *
 * Extraído para que o painel inteiro, um cartão e o ecrã de parede não possam
 * discordar. O ecrã que se lê de longe é o que ninguém confere — se um dia forem
 * três contas, é ele que perde a autoridade primeiro.
 *
 * Um período fechado — semana, mês — entra aqui com `elapsedPct` a 100, porque
 * o período acabou e o plano todo era devido. A regra é a mesma e a leitura
 * volta a ser a de sempre: 100% é verde, quinze pontos abaixo ainda é âmbar.
 *
 * `attainedPct` não é cortado aos 100 em lado nenhum. Uma linha a 144% do plano
 * é para se ver.
 */
export function clockBand(attainedPct: number, elapsedPct: number): ScoreBand {
  if (attainedPct >= elapsedPct) return "GO";
  return attainedPct >= elapsedPct - BEHIND_TOLERANCE_PTS ? "HOLD" : "STOP";
}

export type LineGap = "NO_PLAN" | "NO_SESSION" | "NO_ORDER" | "NO_LEADER" | "NOTHING_LOGGED";

export type LineReading =
  | {
      kind: "SCORED";
      /** `actual / target`. Nunca cortado aos 100. */
      attainedPct: number;
      /** Quanto do turno já passou. 100 num período fechado. */
      elapsedPct: number;
      band: ScoreBand;
    }
  | { kind: LineGap };

export interface LineReadingInput {
  target: number;
  actual: number;
  /** De `shiftClockPct`, ou 100 para um período que já fechou. */
  elapsedPct: number;
  /**
   * As três portas do turno a correr. Omitidas — semana, mês — não são
   * perguntadas: um período fechado não tem sessão aberta nem líder ao turno,
   * e responder "não" por ausência de pergunta dava um ecrã cheio de faltas
   * que ninguém pode ir resolver.
   */
  hasSession?: boolean;
  hasLeader?: boolean;
  orderCount?: number;
}

/**
 * A leitura de uma linha: ou uma pontuação, ou a razão por que não há nenhuma.
 *
 * A ordem importa. Cada estado nomeia uma coisa diferente para alguém ir fazer,
 * e o de fora é o que tem de ser feito primeiro: não vale a pena dizer que não
 * há produção escrita numa linha que ainda não abriu.
 *
 * Um estado que já não existe: NO_RATE. Era a falta da taxa padrão do SKU, e
 * com o relógio ninguém precisa dela — a falha desapareceu do painel porque
 * deixou de ser uma falha.
 */
export function lineReading(input: LineReadingInput): LineReading {
  const { target, actual, elapsedPct, hasSession, hasLeader, orderCount } = input;

  if (hasSession === false) return { kind: "NO_SESSION" };
  if (orderCount != null && orderCount <= 0) return { kind: "NO_ORDER" };
  if (hasLeader === false) return { kind: "NO_LEADER" };

  // Sem plano não há veredicto. Um ecrã verde numa fábrica sem ordens, ou
  // vermelho numa que ainda não abriu, é o ecrã a inventar uma leitura.
  if (!(target > 0)) return { kind: "NO_PLAN" };

  // Nada escrito o turno inteiro não é um zero medido.
  //
  // Nada neste sistema distingue uma linha que não fez nada de uma linha cuja
  // produção ninguém escreveu, e dividir 0 pelo alvo afirma a primeira. A 08/08
  // isso pôs a Line 1 a 0%, vermelha, CRITICAL, enquanto o iTouching tinha a
  // máquina a misturar segundos antes. O que precisava de nome era a ausência
  // do registo, que é também a única coisa em que alguém pode pegar.
  if (!(actual > 0)) return { kind: "NOTHING_LOGGED" };

  const attainedPct = (actual / target) * 100;
  return { kind: "SCORED", attainedPct, elapsedPct, band: clockBand(attainedPct, elapsedPct) };
}

/** As duas palavras que cabem na chapa, lidas do outro lado da nave. */
export const BAND_STATUS: Record<ScoreBand, string> = {
  GO: "On target",
  HOLD: "Behind",
  STOP: "Critical",
};

/**
 * As mesmas cores, uma vez só. O ecrã de parede pinta chapas inteiras com isto
 * e o board pinta filetes; a cor é a mesma nos dois porque vem daqui.
 */
export const BAND_BG: Record<ScoreBand, string> = {
  GO: "bg-success",
  HOLD: "bg-warning",
  STOP: "bg-destructive",
};

/**
 * A mesma banda quando o que se pinta é o número e não o fundo atrás dele.
 *
 * Os tons `-strong` existem para texto: os `bg-` acima são fundos, e escrever
 * `text-success` num número dá-lhe um verde que não passa contraste sobre o
 * cartão. Vive aqui pela mesma razão que os outros dois — o Control Center
 * tinha o seu próprio par de limiares e a sua própria escolha de tom, e era
 * assim que a mesma linha aparecia com cores diferentes em dois ecrãs.
 */
export const BAND_TEXT: Record<ScoreBand, string> = {
  GO: "text-success-strong",
  HOLD: "text-warning-strong",
  STOP: "text-destructive-strong",
};

/**
 * Cada estado nomeia-se. "No reading" era o painel a descrever a dificuldade
 * dele, e lia-se igual numa linha à espera de ordem e numa linha sem ninguém
 * registado — duas pessoas diferentes, dois trabalhos diferentes, uma palavra.
 */
export const LINE_STATUS: Record<LineGap, string> = {
  NO_PLAN: "No plan",
  NO_SESSION: "Not started",
  NO_ORDER: "No order",
  NO_LEADER: "No leader",
  NOTHING_LOGGED: "Not logged",
};

/** O mesmo, por extenso, onde há largura para uma frase. */
export const LINE_MESSAGES: Record<LineGap, string> = {
  NO_PLAN: "Nothing planned for this period",
  NO_SESSION: "Line not started",
  NO_ORDER: "No order",
  NO_LEADER: "Nobody logged in on the line",
  NOTHING_LOGGED: "No output logged yet",
};

/**
 * Se o estado é trabalho de alguém agora.
 *
 * Uma linha à espera de ordem e uma linha cuja produção ninguém escreveu são
 * ambas não-medíveis, mas só uma delas tem quem chamar. A primeira fica
 * cinzenta; a segunda leva o filete âmbar, porque passar despercebida até ao
 * fim do turno é o risco todo.
 */
export const LINE_NEEDS_ACTION: Record<LineGap, boolean> = {
  NO_PLAN: false,
  NO_SESSION: false,
  NO_ORDER: false,
  NO_LEADER: true,
  NOTHING_LOGGED: true,
};

/**
 * Uma ordem cumprida ou ultrapassada lê-se COMPLETE, nunca um saldo negativo.
 * O iTouching reporta Order Balance abaixo de zero quando a linha passa da
 * ordem, e "-412 remaining" lê-se no chão como uma falta.
 */
export function balanceLabel(plannedQty: number | null | undefined, produced: number): string {
  const plan = Number(plannedQty ?? 0);
  if (plan <= 0) return "—";
  const left = plan - Math.max(0, Number(produced) || 0);
  return left <= 0 ? "COMPLETE" : String(Math.round(left));
}

/**
 * Minutos desde a última entrada do operador, ou nulo quando não há nenhuma.
 * Mostra-se ao lado do número porque é a diferença entre "a linha fez isto" e
 * "alguém nos disse isto há duas horas".
 */
export function lastEntryAgeMinutes(updatedAts: Array<string | Date | null | undefined>, now: Date): number | null {
  const times = updatedAts
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  return Math.max(0, Math.floor((now.getTime() - Math.max(...times)) / MS_PER_MIN));
}
