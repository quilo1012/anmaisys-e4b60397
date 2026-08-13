import { describe, it, expect } from "vitest";
import {
  shiftClockPct,
  clockBand,
  lineReading,
  lastEntryAgeMinutes,
  itemClockPct,
  BEHIND_TOLERANCE_PTS,
  BAND_STATUS,
  BAND_BG,
  BAND_TEXT,
  type ScoreBand,
} from "./linePerformance";

/**
 * O relógio do turno substituiu o ritmo.
 *
 * O que morreu aqui, e porquê: o ritmo comparava o que a linha fez com o que
 * devia ter feito segundo a taxa padrão do SKU (peças/hora) vezes o tempo
 * trabalhado. Duas coisas o afundaram. A primeira é que mais de duzentos SKUs
 * activos têm `target_per_hour` a zero ou nulo, por isso para a maior parte dos
 * produtos o número não existia. A segunda é que, depois de o cartão passar a
 * imprimir a fatia do alvo, o ritmo continuou a decidir a COR sem estar escrito
 * em lado nenhum: o painel mostrava 9%, uma luz verde, e uma legenda a dizer
 * que verde era ≥95%. Nenhum supervisor podia fechar essa conta.
 *
 * A regra nova usa o relógio, que está na parede e não precisa de base de
 * dados: quanto do turno já passou contra quanto do alvo já está feito. Os dois
 * números ficam ambos no ecrã, e é a distância entre eles que dá a cor.
 */

const DAY_START = new Date("2026-08-12T06:00:00Z");
const DAY_END = new Date("2026-08-12T18:00:00Z");
/** `h` horas depois do início do turno. */
const at = (h: number) => new Date(DAY_START.getTime() + h * 3_600_000);

describe("shiftClockPct — quanto do turno já passou", () => {
  it("é 0 no instante em que o turno abre", () => {
    expect(shiftClockPct(DAY_START, DAY_END, DAY_START)).toBe(0);
  });

  it("é 50 a meio de um turno de doze horas", () => {
    expect(shiftClockPct(DAY_START, DAY_END, at(6))).toBe(50);
  });

  it("dá as cinco horas de doze do cartão da Line 1", () => {
    expect(shiftClockPct(DAY_START, DAY_END, at(5))).toBeCloseTo(41.67, 1);
  });

  it("não passa dos 100 quando o turno já acabou e ninguém fechou o ecrã", () => {
    expect(shiftClockPct(DAY_START, DAY_END, at(19))).toBe(100);
  });

  it("não desce abaixo de zero antes de o turno abrir", () => {
    expect(shiftClockPct(DAY_START, DAY_END, at(-2))).toBe(0);
  });

  it("atravessa a meia-noite sem se enganar — o turno da noite é 18:00 às 06:00", () => {
    const nightStart = new Date("2026-08-12T18:00:00Z");
    const nightEnd = new Date("2026-08-13T06:00:00Z");
    const twoAm = new Date("2026-08-13T02:00:00Z");
    expect(shiftClockPct(nightStart, nightEnd, twoAm)).toBeCloseTo(66.67, 1);
  });

  it("não rebenta com um turno de duração zero", () => {
    expect(shiftClockPct(DAY_START, DAY_START, DAY_START)).toBe(100);
  });
});

describe("clockBand — a cor sai da distância entre dois números que estão no ecrã", () => {
  it("é verde quando o feito acompanha o tempo passado", () => {
    expect(clockBand(45, 42)).toBe("GO");
  });

  it("é verde no empate exacto", () => {
    expect(clockBand(42, 42)).toBe("GO");
  });

  it("continua verde para uma linha à frente do relógio, sem tecto", () => {
    expect(clockBand(130, 50)).toBe("GO");
  });

  it(`é âmbar até ${BEHIND_TOLERANCE_PTS} pontos atrás do relógio, inclusive`, () => {
    expect(clockBand(42 - BEHIND_TOLERANCE_PTS, 42)).toBe("HOLD");
  });

  it("é vermelho assim que passa dessa tolerância", () => {
    expect(clockBand(42 - BEHIND_TOLERANCE_PTS - 0.1, 42)).toBe("STOP");
  });

  it("dá vermelho à Line 1 do screenshot: 9% feito, 42% do turno passado", () => {
    expect(clockBand(9.25, 41.67)).toBe("STOP");
  });

  it("não pinta de vermelho uma linha nos primeiros minutos do turno", () => {
    // Era isto que o WARMUP_MINUTES do ritmo andava a remendar: com o relógio
    // não é preciso caso especial nenhum, porque aos 5% de turno decorrido
    // ninguém pode estar mais de 15 pontos atrás.
    expect(clockBand(0, 5)).toBe("HOLD");
  });

  it("num período fechado volta a ser a leitura de sempre contra o plano", () => {
    expect(clockBand(100, 100)).toBe("GO");
    expect(clockBand(85, 100)).toBe("HOLD");
    expect(clockBand(84.9, 100)).toBe("STOP");
  });
});

describe("lineReading — os estados que não são uma percentagem", () => {
  const base = { hasSession: true, hasLeader: true, orderCount: 1, target: 3233, actual: 299, elapsedPct: 41.67 };

  it("pontua a Line 1: 299 de 3.233 às cinco horas de doze", () => {
    const r = lineReading(base);
    expect(r.kind).toBe("SCORED");
    if (r.kind !== "SCORED") return;
    expect(r.attainedPct).toBeCloseTo(9.25, 2);
    expect(r.elapsedPct).toBeCloseTo(41.67, 2);
    expect(r.band).toBe("STOP");
  });

  it("sem plano não há veredicto — um ecrã não inventa uma leitura que não tem", () => {
    expect(lineReading({ ...base, target: 0 }).kind).toBe("NO_PLAN");
  });

  it("a linha que não abriu diz que não abriu, antes de tudo o resto", () => {
    expect(lineReading({ ...base, hasSession: false, orderCount: 0 }).kind).toBe("NO_SESSION");
  });

  it("sem ordem aberta, é isso que se diz", () => {
    expect(lineReading({ ...base, orderCount: 0 }).kind).toBe("NO_ORDER");
  });

  it("sem líder registado, é isso que se diz", () => {
    expect(lineReading({ ...base, hasLeader: false }).kind).toBe("NO_LEADER");
  });

  it("nada escrito não é um zero medido", () => {
    // Nada neste sistema distingue uma linha que não fez nada de uma linha cuja
    // produção ninguém escreveu, e dividir 0 pelo alvo afirma a primeira.
    expect(lineReading({ ...base, actual: 0 }).kind).toBe("NOTHING_LOGGED");
  });

  it("um período fechado não é interrogado sobre sessões nem líderes", () => {
    // Semana e mês não têm turno a correr: o chamador omite as portas e o alvo
    // inteiro já era devido.
    const r = lineReading({ target: 10000, actual: 9600, elapsedPct: 100 });
    expect(r.kind).toBe("SCORED");
    if (r.kind !== "SCORED") return;
    expect(r.band).toBe("HOLD");
  });

  it("não corta a percentagem aos 100 — uma linha a 144% do plano é para se ver", () => {
    const r = lineReading({ target: 3338, actual: 4799, elapsedPct: 100 });
    expect(r.kind).toBe("SCORED");
    if (r.kind !== "SCORED") return;
    expect(r.attainedPct).toBeCloseTo(143.77, 1);
    expect(r.band).toBe("GO");
  });

  it("já não pergunta pela taxa padrão do SKU, que era a falha que nunca se resolvia", () => {
    // O ritmo devolvia NO_RATE e a linha ficava sem cor nenhuma. Com o relógio,
    // uma linha sem taxa nenhuma registada pontua como qualquer outra.
    const r = lineReading({ ...base, actual: 1500 });
    expect(r.kind).toBe("SCORED");
  });
});

/**
 * A idade da última entrada, que agora veste dois ecrãs.
 *
 * Estava sem teste nenhum enquanto só a parede a usava. Passou também para o
 * tablet da linha, e a forma como lá quase falhou é a que vale a pena fixar: o
 * `updated_at` vinha na consulta e morria num `map` que o não copiava, por isso
 * a função recebia uma lista de `undefined` e devolvia null — e o rodapé dizia
 * "nothing entered yet" numa linha a produzir, sem erro nenhum em lado nenhum.
 */
describe("lastEntryAgeMinutes", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("conta a partir da entrada mais recente, e não da primeira da lista", () => {
    const age = lastEntryAgeMinutes(
      ["2026-08-13T09:00:00Z", "2026-08-13T11:30:00Z", "2026-08-13T10:00:00Z"],
      now,
    );
    expect(age).toBe(30);
  });

  it("sem uma única data devolve null, que é o que distingue vazio de agora mesmo", () => {
    expect(lastEntryAgeMinutes([], now)).toBeNull();
    expect(lastEntryAgeMinutes([null, undefined], now)).toBeNull();
    // O caso do tablet: o campo existia mas ninguém o copiou até aqui.
    expect(lastEntryAgeMinutes([undefined, undefined, undefined], now)).toBeNull();
  });

  it("ignora as ausências sem deixar de contar as que existem", () => {
    expect(lastEntryAgeMinutes([null, "2026-08-13T11:45:00Z", undefined], now)).toBe(15);
  });

  it("uma data que não é data não conta como entrada", () => {
    expect(lastEntryAgeMinutes(["nem uma data"], now)).toBeNull();
    expect(lastEntryAgeMinutes(["nem uma data", "2026-08-13T11:00:00Z"], now)).toBe(60);
  });

  // Relógios de tablet andam à frente. "Há -3 minutos" não é uma coisa que se
  // possa dizer a alguém no chão de fábrica.
  it("uma entrada no futuro lê-se como agora, e não como um número negativo", () => {
    expect(lastEntryAgeMinutes(["2026-08-13T12:05:00Z"], now)).toBe(0);
  });
});

/**
 * As três tabelas de banda têm de falar das mesmas bandas.
 *
 * O achado que trouxe o `BAND_TEXT` a existir foi este: o Control Center pintava
 * a percentagem com um par de limiares só dele (95/80) e uma escolha de tom só
 * dele, e era assim que a mesma linha aparecia verde num ecrã e âmbar noutro. As
 * bandas passaram a sair todas do `clockBand` — mas isso só fecha a porta se cada
 * banda tiver as três formas de ser mostrada. Uma banda nova que nasça só com
 * fundo aparece sem cor nenhuma no ecrã que usa texto, e sem erro nenhum.
 */
describe("as bandas têm nome, fundo e cor de texto", () => {
  const bandas: ScoreBand[] = ["GO", "HOLD", "STOP"];

  it("as três tabelas cobrem exactamente as mesmas bandas", () => {
    expect(Object.keys(BAND_STATUS).sort()).toEqual([...bandas].sort());
    expect(Object.keys(BAND_BG).sort()).toEqual([...bandas].sort());
    expect(Object.keys(BAND_TEXT).sort()).toEqual([...bandas].sort());
  });

  it("nenhuma entrada fica vazia", () => {
    for (const b of bandas) {
      expect(BAND_STATUS[b]).toBeTruthy();
      expect(BAND_BG[b]).toBeTruthy();
      expect(BAND_TEXT[b]).toBeTruthy();
    }
  });

  // Fundo e texto não são intermutáveis: `text-success` num número sobre um
  // cartão claro não passa contraste, e é para isso que existem os `-strong`.
  it("o tom de texto é o `-strong`, e o de fundo não", () => {
    expect(BAND_TEXT.GO).toContain("-strong");
    expect(BAND_TEXT.HOLD).toContain("-strong");
    expect(BAND_TEXT.STOP).toContain("-strong");
    expect(BAND_BG.GO.startsWith("bg-")).toBe(true);
  });
});

/**
 * O relógio de UM SKU, que não é o relógio do turno.
 *
 * Medido antes de escrito. Nos 60 dias até 13/08, das 75 linhas de SKU com
 * plano e com `started_at`, 36 arrancam na primeira hora do turno — para essas
 * os dois relógios dizem o mesmo — mas 35 arrancam depois das três horas e 25
 * depois das seis, com uma média de 3h17 depois da abertura. Pintar um SKU que
 * entrou à sétima hora contra um turno que já vai em 58% é dá-lo por atrasado
 * antes de ele ter tido tempo: é o mesmo erro de comparar contra um período
 * que ainda não decorreu, só que uma camada mais abaixo.
 *
 * O prazo é o fim do turno, porque é isso que a folha de plano promete: esta
 * quantidade, feita até ao fim. Logo o relógio do SKU é a fatia do SEU tempo —
 * de quando arrancou até ao fim do turno — que já passou.
 */
describe("itemClockPct — o relógio de um SKU, contado do seu próprio arranque", () => {
  it("é 0 no instante em que o SKU arranca, mesmo com meio turno já passado", () => {
    expect(itemClockPct(at(6), null, DAY_END, at(6))).toBe(0);
  });

  it("é 50 a meio do tempo que resta ao SKU, não a meio do turno", () => {
    // Arranca às 6h de turno, tem 6h até ao fim; às 9h passou metade DELE.
    expect(itemClockPct(at(6), null, DAY_END, at(9))).toBe(50);
  });

  it("é 100 quando o SKU está terminado — período fechado, plano todo devido", () => {
    expect(itemClockPct(at(2), at(5), DAY_END, at(7))).toBe(100);
  });

  it("é null sem arranque conhecido, para o chamador decidir e não adivinhar", () => {
    expect(itemClockPct(null, null, DAY_END, at(6))).toBeNull();
  });

  it("fecha nas duas pontas, para o ecrã que fica ligado a noite inteira", () => {
    expect(itemClockPct(at(6), null, DAY_END, at(20))).toBe(100);
    expect(itemClockPct(at(6), null, DAY_END, at(1))).toBe(0);
  });

  it("um SKU que arranca depois do fim do turno não divide por zero", () => {
    expect(itemClockPct(at(13), null, DAY_END, at(14))).toBe(100);
  });

  it("dá âmbar onde o relógio do turno dava vermelho, no caso medido na base", () => {
    // O caso real: SKU entra à 7ª hora de doze, e às 9h leva 40% do seu plano.
    const started = at(7);
    const now = at(9);
    const attained = 40;
    // Relógio do turno: 75% decorrido → 35 pontos atrás → STOP.
    expect(clockBand(attained, shiftClockPct(DAY_START, DAY_END, now))).toBe("STOP");
    // Relógio do SKU: 40% do SEU tempo decorrido → em dia → GO.
    expect(clockBand(attained, itemClockPct(started, null, DAY_END, now)!)).toBe("GO");
  });
});
