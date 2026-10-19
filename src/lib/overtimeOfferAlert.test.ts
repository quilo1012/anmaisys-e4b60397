import { describe, it, expect } from "vitest";
import { offersToAlert, offerOutcome, readDismissed, rememberDismissed } from "@/lib/overtimeOfferAlert";

const NOW = new Date("2026-10-19T10:00:00");
const ask = (id: string, over: Record<string, unknown> = {}) => ({
  id, on_date: "2026-10-24", starts_at: "06:00:00", ends_at: "18:00:00",
  status: "open" as const, department: null, shift_group: null, created_by: "boss", ...over,
});
const ME = { department: "Production", shift_group: "Day" };
const none = new Map();

describe("offersToAlert — which asks ring", () => {
  it("an open ask for me, unanswered, ahead of now", () => {
    expect(offersToAlert([ask("a")], ME, none, { now: NOW }).map((r) => r.id)).toEqual(["a"]);
  });

  it("never an ask I already answered, yes or no, decided or not", () => {
    const mine = new Map([
      ["y", { answer: "yes" as const, decision: null }],
      ["n", { answer: "no" as const, decision: null }],
      ["b", { answer: "yes" as const, decision: "accepted" as const }],
    ]);
    expect(offersToAlert([ask("y"), ask("n"), ask("b")], ME, mine, { now: NOW })).toEqual([]);
  });

  it("never a closed or cancelled ask, nor one that has started", () => {
    const rows = [
      ask("closed", { status: "closed" }),
      ask("cancelled", { status: "cancelled" }),
      ask("started", { on_date: "2026-10-19", starts_at: "06:00:00" }),
    ];
    expect(offersToAlert(rows as never, ME, none, { now: NOW })).toEqual([]);
  });

  it("not an ask for another department or crew — the person is not eligible", () => {
    const rows = [ask("dept", { department: "Warehouse" }), ask("crew", { shift_group: "Night" })];
    expect(offersToAlert(rows, ME, none, { now: NOW })).toEqual([]);
  });

  it("not on hours already theirs, not one they put off, not one they posted", () => {
    const rows = [ask("clash"), ask("later"), ask("mine", { created_by: "u1" }), ask("ok")];
    const out = offersToAlert(rows, ME, none, {
      now: NOW, clashes: new Map([["clash", "On the board"]]), dismissed: new Set(["later"]), userId: "u1",
    });
    expect(out.map((r) => r.id)).toEqual(["ok"]);
  });

  it("the earliest shift first", () => {
    const rows = [ask("late", { on_date: "2026-10-25" }), ask("night", { starts_at: "18:00:00" }), ask("early")];
    expect(offersToAlert(rows, ME, none, { now: NOW }).map((r) => r.id)).toEqual(["early", "night", "late"]);
  });
});

describe("offerOutcome — said from the row the server wrote", () => {
  it("booked, reserve, undecided yes, no", () => {
    expect(offerOutcome("yes", { answer: "yes", decision: "accepted" })).toBe("booked");
    expect(offerOutcome("yes", { answer: "yes", decision: "reserve" })).toBe("reserve");
    expect(offerOutcome("yes", { answer: "yes", decision: null })).toBe("yes_pending");
    expect(offerOutcome("no", { answer: "no", decision: null })).toBe("declined");
  });
  it("a yes that came back without a row is not called a booking", () => {
    expect(offerOutcome("yes", null)).toBe("yes_pending");
  });
});

describe("Not now — remembered per login", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("round-trips, and one login does not silence another", () => {
    const s = memory();
    rememberDismissed("u1", "a", s);
    expect(readDismissed("u1", s).has("a")).toBe(true);
    expect(readDismissed("u2", s).has("a")).toBe(false);
  });
  it("storage that throws means nothing is remembered, not a crash", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readDismissed("u1", broken).size).toBe(0);
    expect(() => rememberDismissed("u1", "a", broken)).not.toThrow();
  });
});
