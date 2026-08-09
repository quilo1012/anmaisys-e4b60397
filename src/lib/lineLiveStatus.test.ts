import { describe, it, expect } from "vitest";
import { classifyLive, formatStopDuration, stopClock, STALE_AFTER_SECONDS, type LiveReading } from "./lineLiveStatus";

const now = new Date("2026-08-08T17:00:00.000Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

const reading = (over: Partial<LiveReading> = {}): LiveReading => ({
  status: 4,
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

  it("carries the raw status through without interpreting it", () => {
    // 4, 6 and 7 are the values this installation actually returns, and their
    // meaning is an open question with the vendor. Nothing here depends on them.
    for (const status of [4, 6, 7]) {
      const r = classifyLive(reading({ status }), now);
      expect(r.rawStatus).toBe(status);
      expect(r.state).toBe("RUNNING");
    }
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
