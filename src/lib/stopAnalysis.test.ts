import { describe, it, expect } from "vitest";
import {
  classifyStopReason,
  totalsByBucket,
  totalsByReason,
  totalsByLine,
  lineReasonMatrix,
  averagePerLine,
  totalsByDay,
  type ProductionStop,
} from "./stopAnalysis";

/**
 * O que estes testes protegem é a honestidade das percentagens do ecrã.
 *
 * Um motivo mal classificado não rebenta nada: produz um número plausível e errado,
 * impresso e levado a uma reunião. É a pior espécie de defeito, por isso a
 * classificação é declarada e fixada aqui.
 */

let n = 0;
const stop = (p: Partial<ProductionStop>): ProductionStop => ({
  id: `s${++n}`,
  occurred_date: "2026-09-15",
  shift: "DAY",
  line: "Line 1",
  reason: "Alarm",
  duration_minutes: 10,
  machine: null,
  ...p,
});

describe("classifyStopReason", () => {
  it("separa avaria, processo e planeado", () => {
    expect(classifyStopReason("Alarm")).toBe("fault");
    expect(classifyStopReason("Line Preparation")).toBe("process");
    expect(classifyStopReason("Filling Blender/ Blending")).toBe("process");
    expect(classifyStopReason("Deep Clean")).toBe("process");
    expect(classifyStopReason("Awaiting Sample Approval")).toBe("process");
    expect(classifyStopReason("Breaks")).toBe("planned");
    expect(classifyStopReason("No Planned Shift")).toBe("planned");
  });

  it("ignora maiúsculas e espaços à volta", () => {
    expect(classifyStopReason("  line preparation  ")).toBe("process");
    expect(classifyStopReason("ALARM")).toBe("fault");
  });

  it("um motivo desconhecido fica por classificar, não cai num balde por omissão", () => {
    // Se isto passasse a "process", a categoria maior crescia sozinha sempre que o
    // iTouching ganhasse um código novo — e ninguém dava por isso.
    expect(classifyStopReason("Gremlins")).toBe("unknown");
    expect(classifyStopReason(null)).toBe("unknown");
    expect(classifyStopReason("")).toBe("unknown");
  });

  it("cobre os dez motivos que a fábrica emitiu em Setembro de 2026", () => {
    const reais = [
      "No Planned Shift", "Breaks", "Line Preparation", "Filling Blender/ Blending",
      "Brushing and Cleaning", "Deep Clean", "Alarm", "Awaiting Sample Approval",
      "Waiting", "Awaiting Line Approval", "Drill Cleaning", "Shift Change Over",
    ];
    const porClassificar = reais.filter((r) => classifyStopReason(r) === "unknown");
    expect(porClassificar).toEqual([]);
  });
});

describe("totalsByBucket", () => {
  const stops = [
    stop({ reason: "Line Preparation", duration_minutes: 60 }),
    stop({ reason: "Deep Clean", duration_minutes: 40 }),
    stop({ reason: "Alarm", duration_minutes: 20 }),
    stop({ reason: "Breaks", duration_minutes: 80 }),
  ];

  it("soma por balde e devolve na ordem de leitura", () => {
    const t = totalsByBucket(stops);
    expect(t.map((x) => x.bucket)).toEqual(["process", "fault", "planned"]);
    expect(t[0].minutes).toBe(100);
    expect(t[1].minutes).toBe(20);
    expect(t[2].minutes).toBe(80);
  });

  it("as percentagens somam 100", () => {
    const t = totalsByBucket(stops);
    expect(Math.round(t.reduce((a, x) => a + x.pct, 0))).toBe(100);
  });

  it("aguenta duração nula e negativa sem envenenar o total", () => {
    const t = totalsByBucket([
      stop({ reason: "Alarm", duration_minutes: null }),
      stop({ reason: "Alarm", duration_minutes: -5 }),
      stop({ reason: "Alarm", duration_minutes: 10 }),
    ]);
    expect(t[0].minutes).toBe(10);
    expect(t[0].count).toBe(3);
  });

  it("não rebenta com uma lista vazia", () => {
    expect(totalsByBucket([])).toEqual([]);
  });
});

describe("totalsByReason", () => {
  it("ordena do maior para o menor e conta as ocorrências", () => {
    const t = totalsByReason([
      stop({ reason: "Alarm", duration_minutes: 5 }),
      stop({ reason: "Alarm", duration_minutes: 5 }),
      stop({ reason: "Line Preparation", duration_minutes: 30 }),
    ]);
    expect(t[0].key).toBe("Line Preparation");
    expect(t[0].minutes).toBe(30);
    expect(t[1].key).toBe("Alarm");
    expect(t[1].count).toBe(2);
  });

  it("junta um motivo em falta sob um nome próprio em vez de o deitar fora", () => {
    const t = totalsByReason([stop({ reason: null, duration_minutes: 7 })]);
    expect(t[0].key).toBe("(no reason given)");
    expect(t[0].minutes).toBe(7);
  });

  it("a percentagem é do conjunto que entrou, não do universo", () => {
    // É isto que permite ao ecrã perguntar "que fatia da minha PERDA é a preparação"
    // sem a diluir nas pausas de almoço.
    const semPlaneado = totalsByReason([
      stop({ reason: "Line Preparation", duration_minutes: 75 }),
      stop({ reason: "Alarm", duration_minutes: 25 }),
    ]);
    expect(semPlaneado[0].pct).toBe(75);
  });
});

describe("totalsByLine", () => {
  it("soma por linha, maior primeiro", () => {
    const t = totalsByLine([
      stop({ line: "Line 1", duration_minutes: 10 }),
      stop({ line: "Line 2", duration_minutes: 30 }),
      stop({ line: "Line 1", duration_minutes: 10 }),
    ]);
    expect(t[0]).toMatchObject({ key: "Line 2", minutes: 30, count: 1 });
    expect(t[1]).toMatchObject({ key: "Line 1", minutes: 20, count: 2 });
  });
});

describe("lineReasonMatrix", () => {
  const stops = [
    stop({ line: "Line 1", reason: "Line Preparation", duration_minutes: 20 }),
    stop({ line: "Line 2", reason: "Line Preparation", duration_minutes: 50 }),
    stop({ line: "Line 1", reason: "Alarm", duration_minutes: 5 }),
    stop({ line: "Line 2", reason: "Deep Clean", duration_minutes: 15 }),
  ];

  it("cruza linha com motivo", () => {
    const m = lineReasonMatrix(stops);
    expect(m.cells.get("Line 1|Line Preparation")?.minutes).toBe(20);
    expect(m.cells.get("Line 2|Line Preparation")?.minutes).toBe(50);
  });

  it("uma célula sem paragens simplesmente não existe", () => {
    const m = lineReasonMatrix(stops);
    expect(m.cells.get("Line 1|Deep Clean")).toBeUndefined();
  });

  it("corta pelos motivos maiores para a tabela continuar legível", () => {
    const m = lineReasonMatrix(stops, 1);
    expect(m.reasons).toEqual(["Line Preparation"]);
    expect(m.cells.get("Line 1|Alarm")).toBeUndefined();
  });
});

describe("averagePerLine", () => {
  it("responde a quem é mais lento de cada vez, não a quem parou mais horas", () => {
    // A Line 1 pára mais horas no total (9 × 20 = 180); a Line 2 é mais lenta em cada
    // mudança (3 × 50 = 150). São perguntas diferentes e dão respostas diferentes.
    const stops = [
      ...Array.from({ length: 9 }, () => stop({ line: "Line 1", reason: "Line Preparation", duration_minutes: 20 })),
      ...Array.from({ length: 3 }, () => stop({ line: "Line 2", reason: "Line Preparation", duration_minutes: 50 })),
    ];
    expect(totalsByLine(stops)[0].key).toBe("Line 1");
    const avg = averagePerLine(stops, "Line Preparation");
    expect(avg[0].line).toBe("Line 2");
    expect(avg[0].avgMinutes).toBe(50);
    expect(avg[1].avgMinutes).toBe(20);
  });

  it("deixa de fora as linhas com ocorrências a menos para serem uma média", () => {
    const stops = [
      ...Array.from({ length: 4 }, () => stop({ line: "Line 1", reason: "Deep Clean", duration_minutes: 10 })),
      stop({ line: "Line 9", reason: "Deep Clean", duration_minutes: 300 }),
    ];
    const avg = averagePerLine(stops, "Deep Clean");
    expect(avg.map((a) => a.line)).toEqual(["Line 1"]);
  });
});

describe("totalsByDay", () => {
  it("soma por dia e separa processo de avaria", () => {
    const t = totalsByDay([
      stop({ occurred_date: "2026-09-02", reason: "Line Preparation", duration_minutes: 30 }),
      stop({ occurred_date: "2026-09-02", reason: "Alarm", duration_minutes: 10 }),
      stop({ occurred_date: "2026-09-01", reason: "Breaks", duration_minutes: 60 }),
    ]);
    expect(t.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(t[1]).toMatchObject({ minutes: 40, process: 30, fault: 10 });
    // Uma pausa conta para o total do dia e não conta para nenhum dos dois baldes.
    expect(t[0]).toMatchObject({ minutes: 60, process: 0, fault: 0 });
  });
});
