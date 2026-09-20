/**
 * A typed "HH:mm" onto the day it actually belongs to.
 *
 * It used to be stamped onto whatever day the form happened to be submitted:
 *
 *     const d = new Date(); d.setHours(h, m, 0, 0);
 *
 * On a day shift that is usually right by accident. On nights it is wrong half the
 * time, because the shift crosses midnight and the operator does not. Somebody on the
 * night of 06/08 who logs at 01:00 that a run started at 17:20 gets 07/08 17:20 —
 * eighteen hours AFTER the finish they typed before midnight, which is how a record
 * comes to have a negative duration. Twenty-three of them do.
 *
 * The session knows better than the clock. A NIGHT session dated D runs 18:00 on D to
 * 06:00 on D+1, so an evening time belongs to D and a small-hours time to D+1. A DAY
 * session is all one calendar day.
 */

export type ShiftName = "DAY" | "NIGHT";

/** Where a night shift stops being the evening and starts being the morning. */
const NIGHT_ROLLS_OVER_BEFORE = 12;

/**
 * The instant a typed time refers to, or null when it is not a time.
 *
 * Built in London and returned as UTC, because that is what the column stores and the
 * factory's clocks are on the wall in London whatever the server thinks.
 */
export function shiftTimeToIso(
  hm: string | null | undefined,
  sessionDate: string,
  shift: string | null | undefined,
): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return null;

  // Midnight to noon on a night shift is the morning after. Noon is the split rather
  // than 06:00 so a run that overshoots the end of the shift still lands on the right
  // day — 06:40 on a night is the same morning, not a fortnight of confusion.
  const isNight = (shift ?? "").toUpperCase() === "NIGHT";
  const dayOffset = isNight && hour < NIGHT_ROLLS_OVER_BEFORE ? 1 : 0;

  const base = Date.parse(`${sessionDate}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  const asUtcWallClock = base + (dayOffset * 24 + hour) * 3_600_000 + minute * 60_000;

  // London is UTC or UTC+1. Take the offset at that instant and subtract it, so the
  // wall clock the operator typed is what comes back out.
  const offsetMinutes = londonOffsetMinutes(new Date(asUtcWallClock));
  return new Date(asUtcWallClock - offsetMinutes * 60_000).toISOString();
}

function londonOffsetMinutes(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    +p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second,
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/**
 * The longest a run can be: one shift.
 *
 * An item belongs to a session and a session is one shift, so nothing can run for
 * longer than twelve hours. Three records claim to — 810, 1014 and 1050 minutes — and
 * all three predate the fix above, when the day was stamped from `new Date()`.
 */
const LONGEST_RUN_MIN = 12 * 60;

/**
 * Minutes a run took, or null when the pair cannot describe one.
 *
 * Three ways a pair fails, and all three return null rather than a number, because a
 * number gets averaged into a line's speed and quietly moves it:
 *
 * - **Either end missing.** Nothing to measure.
 * - **Not positive.** A run cannot finish before it starts, and a negative silently
 *   cancels out real minutes. Zero is the same: nine records hold a start and a finish
 *   on the same minute, from a Save that stamped the finish with the clock.
 * - **Longer than a shift.** A seventeen-hour run on a twelve-hour shift is not a slow
 *   run, it is a wrong one, and averaging it in makes the line look half as fast as it
 *   is.
 *
 * Null says "this pair cannot be read", which is what a screen should show. It is not
 * the same as zero, and the difference is the whole point.
 */
export function runMinutes(startIso: string | null, finishIso: string | null): number | null {
  if (!startIso || !finishIso) return null;
  const a = Date.parse(startIso), b = Date.parse(finishIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const mins = Math.round((b - a) / 60_000);
  if (mins <= 0 || mins > LONGEST_RUN_MIN) return null;
  return mins;
}

/**
 * A hora que o relógio da fábrica mostra — "HH:mm" em Londres, ou `null`.
 *
 * O ecrã escrevia as horas com `toTimeString()`, que é o fuso da máquina que está a
 * mostrar o ecrã. Em Inglaterra e em Portugal dá o mesmo e por isso nunca se viu; num
 * portátil noutro fuso a folha inteira anda umas horas, e o campo de edição anda com
 * ela: mostrava a hora local e gravava a de Londres (`shiftTimeToIso`), por isso abrir
 * uma fila e sair dela sem lhe tocar bastava para mudar a hora gravada.
 *
 * A coluna guarda um instante e a fábrica lê-o no relógio da parede. É esse o que se
 * escreve, esteja quem está a ler onde estiver.
 */
export function wallClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false, hour: "2-digit", minute: "2-digit",
  }).format(at);
  return hm === "24:00" ? "00:00" : hm;
}

/**
 * Where a run sits on the shift's own clock, in minutes from midnight.
 *
 * The sheet is read down the clock, so it has to be sorted by the number printed in
 * the cell — not by the instant behind it. The two usually agree. They stop agreeing
 * on the records stamped with the wrong day (the bug at the top of this file): the
 * cell reads 17:20 and the column reads the morning after, and sorting on the instant
 * would file that run a day away from the shift it belongs to.
 *
 * A night is one continuous stretch, so the small hours are counted past midnight —
 * 01:20 on a night shift is minute 1520, after 22:10, not eleven hours before it.
 */
export function shiftClockMinutes(
  iso: string | null | undefined,
  shift: string | null | undefined,
): number | null {
  const hm = wallClock(iso);
  const m = /^(\d{2}):(\d{2})$/.exec(hm ?? "");
  if (!m) return null;
  const hour = Number(m[1]);
  const isNight = (shift ?? "").toUpperCase() === "NIGHT";
  const rollsOver = isNight && hour < NIGHT_ROLLS_OVER_BEFORE;
  return (rollsOver ? hour + 24 : hour) * 60 + Number(m[2]);
}

/** The fields an ordering needs. Anything wider than this is welcome. */
export type RunOrdered = {
  started_at?: string | null;
  finished_at?: string | null;
  display_order?: number | null;
  created_at?: string | null;
  id?: string | null;
};

/**
 * A shift's runs in the order they happened.
 *
 * Production Control asked Postgres for a session's items without asking for an order,
 * and an embedded resource with no order comes back in whatever order the heap holds
 * that minute — so the Tablet Line of 17/09 opened at 14:45, went back to 06:20 and
 * then to 07:50. Three runs, one shift, and no way to read the shift down the page.
 *
 * The clock decides. A row nobody has timed yet has no place in a chronology, so it
 * goes after the ones that do, keeping the sequence the line planned for it
 * (`display_order`, the same key the operator's own screen sorts on) — which is also
 * what the whole session falls back to when no run was timed at all.
 *
 * Returns a new array: the caller's list is the query cache's, and sorting it in place
 * mutates state React is holding.
 */
export function inRunOrder<T extends RunOrdered>(
  items: readonly T[],
  shift: string | null | undefined,
): T[] {
  const plan = (i: T) => (typeof i.display_order === "number" ? i.display_order : Number.MAX_SAFE_INTEGER);
  const born = (i: T) => i.created_at ?? "";
  return [...items].sort((a, b) => {
    const sa = shiftClockMinutes(a.started_at, shift);
    const sb = shiftClockMinutes(b.started_at, shift);
    if (sa === null && sb !== null) return 1;
    if (sa !== null && sb === null) return -1;
    if (sa !== null && sb !== null) {
      if (sa !== sb) return sa - sb;
      // Two runs opened on the same minute: the one that closed first came first, and
      // one still running comes after one that has finished.
      const fa = shiftClockMinutes(a.finished_at, shift);
      const fb = shiftClockMinutes(b.finished_at, shift);
      if (fa === null && fb !== null) return 1;
      if (fa !== null && fb === null) return -1;
      if (fa !== null && fb !== null && fa !== fb) return fa - fb;
    }
    return plan(a) - plan(b)
      || born(a).localeCompare(born(b))
      || (a.id ?? "").localeCompare(b.id ?? "");
  });
}

/** O que um turno diz de cada corrida: o que ela demorou, e o que esteve antes dela. */
export type RunTiming = {
  /** Minutos de corrida — `null` quando o par não descreve uma (ver `runMinutes`). */
  runMin: number | null;
  /** Minutos desde o último fim registado. Negativo é sobreposição, não mudança. */
  sinceMin: number | null;
};

/**
 * O relógio de um turno, corrida a corrida.
 *
 * A folha tinha início e fim e mais nada: os minutos que uma corrida levou, e os que a
 * linha esteve parada entre duas, faziam-se de cabeça fila a fila. São as duas
 * perguntas que se fazem a esta folha — quanto tempo é que aquilo levou, e quanto se
 * perdeu entre uma coisa e a seguinte.
 *
 * A **corrida** é o `runMinutes`, com as três recusas dele: o mesmo número que a
 * Performance usa, para que os dois ecrãs não digam durações diferentes da mesma fila.
 *
 * O **intervalo** conta-se no relógio do turno (`shiftClockMinutes`) e não no instante,
 * pela mesma razão que a ordem: é o intervalo entre os números que a folha mostra, e
 * numa noite que atravessa a meia-noite 22:10 → 01:20 são 190 minutos e não menos vinte
 * horas. Mede-se desde o **último fim registado** e não desde a fila de cima: uma
 * corrida por fechar no meio do turno não apaga o intervalo da seguinte.
 *
 * Um negativo não é um intervalo curto — são duas corridas ao mesmo tempo na mesma
 * linha. Ou uma hora está errada, ou o turno correu duas coisas de uma vez; as duas
 * merecem ser vistas, e por isso o número sai com o sinal em vez de ser deitado fora.
 *
 * Espera a lista JÁ ordenada (`inRunOrder`) — é sobre a ordem do relógio que um
 * intervalo quer dizer alguma coisa.
 */
export function runTimings<T extends RunOrdered>(
  ordered: readonly T[],
  shift: string | null | undefined,
): RunTiming[] {
  let lastFinish: number | null = null;
  return ordered.map((i) => {
    const start = shiftClockMinutes(i.started_at, shift);
    const finish = shiftClockMinutes(i.finished_at, shift);
    const sinceMin = start !== null && lastFinish !== null ? start - lastFinish : null;
    if (finish !== null) lastFinish = finish;
    return { runMin: runMinutes(i.started_at ?? null, i.finished_at ?? null), sinceMin };
  });
}

/** Minutos como se dizem em voz alta: 47m, 1h00, 6h35. Sem número, um travessão. */
export function formatRunMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const whole = Math.round(Math.abs(min));
  if (whole < 60) return `${whole}m`;
  return `${Math.floor(whole / 60)}h${String(whole % 60).padStart(2, "0")}`;
}
