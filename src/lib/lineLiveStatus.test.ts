import { describe, it, expect } from "vitest";
import { classifyLive, formatStopDuration, stopClock, STALE_AFTER_SECONDS, ITOUCH_STATUS_MEANING, type LiveReading } from "./lineLiveStatus";

const now = new Date("2026-08-08T17:00:00.000Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

// Status 1 by default: a machine iTouching reports as healthy. It used to be 4,
// which is one of the values this installation returns for a machine that is NOT
// running — so every test that meant "a running line" was written on a stopped one.
const reading = (over: Partial<LiveReading> = {}): LiveReading => ({
  status: 1,
  reason: null,
  planned: null,
  seenAt: secondsAgo(20),
  ...over,
});

describe("classifyLive", () => {
  it("reads no stop code as running", () => {
    const r = classifyLive(reading(), now);
    expect(r.state).toBe("RUNNING");
    expect(r.label).toBe("RUNNING");
    expect(r.ageSeconds).toBe(20);
  });

  it("names a planned stop and keeps it quiet", () => {
    // Line 6 today: Deep Clean, planned in the catalogue.
    const r = classifyLive(reading({ status: 7, reason: "Deep Clean", planned: true }), now);
    expect(r.state).toBe("PLANNED_STOP");
    expect(r.label).toBe("Deep Clean");
  });

  it("names an unplanned stop", () => {
    const r = classifyLive(reading({ status: 7, reason: "Mechanical Stop", planned: false }), now);
    expect(r.state).toBe("UNPLANNED_STOP");
    expect(r.label).toBe("Mechanical Stop");
  });

  it("still shows a code the catalogue does not know, and flags it", () => {
    // "Electrical Stop" is one of 7 mapped labels with no catalogue row. Losing
    // the label would leave the card blank on exactly the stop that matters most.
    const r = classifyLive(reading({ status: 7, reason: "Electrical Stop", planned: null }), now);
    expect(r.label).toBe("Electrical Stop");
    expect(r.uncatalogued).toBe(true);
    expect(r.state).toBe("UNPLANNED_STOP");
  });

  it("does not treat a known planned code as uncatalogued", () => {
    const r = classifyLive(reading({ reason: "Breaks", planned: true }), now);
    expect(r.uncatalogued).toBe(false);
  });

  it("treats blank and whitespace reasons as no stop at all", () => {
    expect(classifyLive(reading({ reason: "" }), now).state).toBe("RUNNING");
    expect(classifyLive(reading({ reason: "   " }), now).state).toBe("RUNNING");
  });
});

describe("classifyLive — freshness", () => {
  it("goes to no signal past the threshold", () => {
    const r = classifyLive(reading({ seenAt: secondsAgo(STALE_AFTER_SECONDS + 1) }), now);
    expect(r.state).toBe("NO_SIGNAL");
  });

  it("stays live right up to the threshold", () => {
    const r = classifyLive(reading({ seenAt: secondsAgo(STALE_AFTER_SECONDS) }), now);
    expect(r.state).toBe("RUNNING");
  });

  it("keeps the last known reason when the signal drops", () => {
    const r = classifyLive(
      reading({ status: 7, reason: "Electrical Stop", planned: null, seenAt: secondsAgo(600) }),
      now,
    );
    expect(r.state).toBe("NO_SIGNAL");
    expect(r.label).toContain("Electrical Stop");
    expect(r.ageSeconds).toBe(600);
  });

  it("a machine that was never read is no signal, not running", () => {
    const r = classifyLive(reading({ seenAt: null }), now);
    expect(r.state).toBe("NO_SIGNAL");
    expect(r.ageSeconds).toBeNull();
  });

  it("never reports a negative age if a clock skews", () => {
    const r = classifyLive(reading({ seenAt: new Date(now.getTime() + 5000) }), now);
    expect(r.ageSeconds).toBe(0);
  });
});

describe("classifyLive — nothing to read", () => {
  it("says so when the line has no mapped machine", () => {
    expect(classifyLive(null, now).state).toBe("NOT_MAPPED");
    expect(classifyLive(undefined, now).state).toBe("NOT_MAPPED");
  });

  it("carries the raw status through untouched, whatever it decides", () => {
    // The number goes into the tooltip verbatim, because its meaning is still an
    // open question with the vendor and the next person to ask needs to see it.
    for (const status of [1, 2, 4, 6, 7]) {
      expect(classifyLive(reading({ status }), now).rawStatus).toBe(status);
    }
  });
});

describe("a line with no stop code is not thereby running", () => {
  // 12/08 às 09:57 UTC: seis das sete linhas estavam em `last_status` 4 ou 6, sem
  // código de paragem, e as sete leram RUNNING em verde. A Line 5 tinha feito 0
  // unidades, não tinha ordem nenhuma, e a manhã dela em iTouching é Brushing and
  // Cleaning → Line Preparation → Alarm: estava a ser limpa e preparada.
  //
  // Ausência de código não é prova de produção. É iTouching a não ter um código
  // activo NAQUELE minuto — os `production_downtimes` de hoje mostram códigos a
  // aparecer e a fechar de minuto a minuto na mesma linha. Quem decide é o estado.
  it("only calls it running on a status iTouching reports as healthy", () => {
    for (const status of [1, 2]) {
      expect(classifyLive(reading({ status }), now).state).toBe("RUNNING");
    }
  });

  it("does not paint a line green on a status nobody has read", () => {
    // O 4 saiu desta lista em 13/08, e saiu por prova, não por pressão: quatro
    // linhas em 4 e verdes no ecrã do fornecedor à mesma hora (ver o teste do 4,
    // mais abaixo). Fica o que continua por ler.
    //
    // Nota sobre o que este teste protege. Ausência de código NUNCA foi
    // autorização para pintar verde — foi essa a leitura errada de 12/08, quando
    // sete linhas ficaram verdes e a Line 5 estava a ser limpa. Continua a ser o
    // estado a decidir, e um estado por traduzir não decide nada.
    for (const status of [6, 7]) {
      expect(classifyLive(reading({ status }), now).state).not.toBe("RUNNING");
    }
  });

  it("does not call it a stop either, on a status nobody has read", () => {
    // 12/08 às 21:38 UTC, os dois ecrãs lado a lado: Filler Line 1 em
    // `last_status` 4 e Filler Line 2 em 6, ambas sem código, e o quadro do
    // iTouching a dizer "Running" nas duas — 12,1 e 21,8 enchimentos por minuto,
    // que nenhuma máquina parada faz. As paradas com código (3 e 4, Breaks)
    // liam-se bem, porque o código decide antes do estado.
    //
    // Nenhuma linha desta fábrica reporta 1 ou 2. A única aparição registada do
    // estado 1 numa linha real — Filler Line 4, 12/08 às 10:45 UTC — trazia um
    // Deep Clean activo, ou seja, uma linha PARADA. O conjunto {1, 2} não é
    // apenas incompleto: pode estar ao contrário.
    //
    // Por isso este ecrã deixa de responder à pergunta. Um estado fora do mapa
    // não é produção nem paragem; é um número que ninguém traduziu, e dizê-lo é
    // a única leitura que não inventa nada.
    for (const status of [6, 7]) {
      expect(classifyLive(reading({ status }), now).state).not.toBe("STOPPED_NO_CODE");
    }
  });

  it("reads status 4 as running — the number this factory sends while it is filling", () => {
    // O par que faltava, observado ao minuto em 13/08 às 07:33 UTC: Filler Line
    // 2, 3 e 6 e a Tablet Line em `last_status` 4 com `last_downtime_code` vazio,
    // e o supervisor a confirmar as quatro VERDES, "Running", no ecrã do
    // iTouching à mesma hora. Não é uma inferência a partir do número: é a
    // legenda do fornecedor lida em paralelo com a coluna.
    //
    // Segunda observação independente, 12/08 às 21:38 UTC: Filler Line 1 em 4,
    // sem código, "Running" a 12,1 enchimentos por minuto.
    //
    // E o contra-teste, do mesmo dia: 7 nunca apareceu sem código. Às 07:33 as
    // cinco máquinas paradas — Linhas 1, 4, 5, GEL e Capsules MC 2 — estavam
    // todas em 7 com uma razão activa, e a Line 5 passou de 6 para 7 no minuto
    // em que alguém escolheu "Brushing and Cleaning". O 4 é o outro lado disso.
    const r = classifyLive(reading({ status: 4 }), now);
    expect(r.state).toBe("RUNNING");
    expect(r.label).toBe("RUNNING");
    expect(r.rawStatus).toBe(4);
    expect(r.stoppedForSeconds).toBeNull();
  });

  it("shows the raw status in the pill, so the floor can quote it to the vendor", () => {
    // O 6 continua por traduzir, e é o único que resta. Foi visto duas vezes e as
    // duas apontam para lados opostos: em 12/08 a Filler Line 2 estava em 6 e
    // lia "Running"; em 13/08 a Filler Line 5 estava em 6 e dois minutos depois
    // tinha "Brushing and Cleaning", ou seja, tinha parado. Escrever um dos dois
    // aqui seria dar a um palpite a mesma aparência que o 4 acabou de ganhar.
    const r = classifyLive(reading({ status: 6 }), now);
    expect(r.state).toBe("UNKNOWN_STATUS");
    expect(r.label).toBe("STATUS 6 · UNKNOWN");
    expect(r.rawStatus).toBe(6);
    expect(r.stoppedForSeconds).toBeNull();
  });

  it("still names a stop with no code, for a status known to mean one", () => {
    // O ramo continua aqui, e vazio de propósito: no dia em que o fornecedor
    // disser o que 4 e 6 são, a correcção é uma linha nesta tabela e este teste
    // já a cobre. Nenhum valor é adivinhado até lá.
    ITOUCH_STATUS_MEANING.set(99, "STOPPED_NO_CODE");
    try {
      const r = classifyLive(reading({ status: 99 }), now);
      expect(r.state).toBe("STOPPED_NO_CODE");
      // iTouching's own legend: RUNNING / STOPPED-NO CODE / UNPLANNED STOP /
      // PLANNED STOP. The fourth state was the one this board did not have.
      expect(r.label).toBe("STOPPED · NO CODE");
      expect(r.stoppedForSeconds).toBeNull();
    } finally {
      ITOUCH_STATUS_MEANING.delete(99);
    }
  });

  it("does not claim a state for a reading that carries no status at all", () => {
    expect(classifyLive(reading({ status: null }), now).state).toBe("NO_SIGNAL");
  });

  it("still lets a coded stop name itself, whatever the status number is", () => {
    const r = classifyLive(reading({ status: 4, reason: "Deep Clean", planned: true }), now);
    expect(r.state).toBe("PLANNED_STOP");
    expect(r.label).toBe("Deep Clean");
  });
});

describe("how long the line has been stopped", () => {
  it("times a stop from when the poll first saw it", () => {
    const r = classifyLive(
      reading({ status: 7, reason: "Filling Blender/ Blending", planned: true, stopSince: secondsAgo(1169) }),
      now,
    );
    expect(r.stoppedForSeconds).toBe(1169);
    expect(formatStopDuration(r.stoppedForSeconds)).toBe("0:19:29");
  });

  it("times nothing while the line is running", () => {
    // A counter beside "RUNNING" would be timing nothing, and iTouching's own
    // board puts a clock beside a stop and not beside a running line.
    const r = classifyLive(reading({ stopSince: secondsAgo(900) }), now);
    expect(r.state).toBe("RUNNING");
    expect(r.stoppedForSeconds).toBeNull();
  });

  it("has no counter for a stop nobody started tracking", () => {
    // Maintenance stops carry a work order and are timed by the order's clock.
    const r = classifyLive(reading({ status: 7, reason: "Electrical Issue", planned: false, stopSince: null }), now);
    expect(r.state).toBe("UNPLANNED_STOP");
    expect(r.stoppedForSeconds).toBeNull();
  });

  it("keeps counting a stop whose reading has gone stale", () => {
    const r = classifyLive(
      reading({ status: 7, reason: "Breaks", planned: true, stopSince: secondsAgo(3600), seenAt: secondsAgo(600) }),
      now,
    );
    expect(r.state).toBe("NO_SIGNAL");
    expect(formatStopDuration(r.stoppedForSeconds)).toBe("1:00:00");
  });

  it("never counts backwards", () => {
    const r = classifyLive(
      reading({ status: 7, reason: "Breaks", planned: true, stopSince: new Date(now.getTime() + 5000) }),
      now,
    );
    expect(r.stoppedForSeconds).toBe(0);
  });
});

describe("the one number beside the stop reason", () => {
  // O cartão tem UMA ranhura à direita da razão, e até aqui punha nela duas
  // grandezas diferentes sem dizer qual: o tempo da paragem quando havia um, e
  // a IDADE DA LEITURA quando não havia. As duas escrevem-se em segundos e no
  // mesmo estilo. Line 1 esteve em "Filling Blender/ Blending" — um código
  // requires_wo, que nunca recebia relógio — e o cartão mostrou "78s" ao lado
  // de uma paragem que já durava muito mais do que isso. Lia-se como o tempo da
  // paragem porque está no lugar do tempo da paragem.
  it("times the stop when the stop has a clock", () => {
    const live = classifyLive(
      reading({ status: 7, reason: "Filling Blender/ Blending", planned: true, stopSince: secondsAgo(1169) }),
      now,
    );
    expect(stopClock(live)).toEqual({ kind: "STOP", text: "0:19:29" });
  });

  it("never passes the reading's age off as the stop's duration", () => {
    const live = classifyLive(
      reading({ status: 7, reason: "Filling Blender/ Blending", planned: true, seenAt: secondsAgo(78), stopSince: null }),
      now,
    );
    const clock = stopClock(live);
    expect(clock?.kind).not.toBe("AGE");
    expect(clock?.text).not.toBe("78s");
  });

  it("says the stop is untimed rather than saying nothing", () => {
    // Uma ranhura vazia lê-se como "acabou de parar". O cartão tem de admitir
    // que não sabe há quanto tempo, que é um facto diferente.
    const live = classifyLive(
      reading({ status: 7, reason: "Electrical Stop", planned: null, stopSince: null }),
      now,
    );
    expect(stopClock(live)).toEqual({ kind: "UNTIMED", text: "—" });
  });

  it("ages the reading while the line is running", () => {
    // Aqui o número é honesto: não há paragem para cronometrar, e o que importa
    // é há quanto tempo ninguém confirma este estado.
    expect(stopClock(classifyLive(reading({ seenAt: secondsAgo(20) }), now))).toEqual({ kind: "AGE", text: "20s" });
    expect(stopClock(classifyLive(reading({ seenAt: secondsAgo(600) }), now))).toEqual({ kind: "AGE", text: "10m" });
  });

  it("has nothing to say about a machine nobody ever read", () => {
    expect(stopClock(classifyLive(null, now))).toBeNull();
  });
});

describe("formatStopDuration", () => {
  it("writes H:MM:SS the way the iTouching board does", () => {
    expect(formatStopDuration(0)).toBe("0:00:00");
    expect(formatStopDuration(59)).toBe("0:00:59");
    expect(formatStopDuration(1169)).toBe("0:19:29");
    expect(formatStopDuration(7898)).toBe("2:11:38");
    expect(formatStopDuration(36000)).toBe("10:00:00");
  });

  it("has nothing to write without a duration", () => {
    expect(formatStopDuration(null)).toBeNull();
    expect(formatStopDuration(-1)).toBeNull();
  });
});
