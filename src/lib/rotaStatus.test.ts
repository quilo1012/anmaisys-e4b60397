import { describe, it, expect } from "vitest";
import { isOffRota, statusForPlacement, type RotaCover } from "@/lib/rotaStatus";

const on: RotaCover = { known: true, coversDay: true, onThisBoard: true };
const wrongDay: RotaCover = { known: true, coversDay: false, onThisBoard: true };
const wrongBoard: RotaCover = { known: true, coversDay: true, onThisBoard: false };
const unknown: RotaCover = { known: false, coversDay: false, onThisBoard: true };

describe("isOffRota", () => {
  it("is off when the rota's weekdays do not include the day", () => {
    // Mon–Thu nights is [1,2,3,4]. Friday night is nobody's rota.
    expect(isOffRota(wrongDay)).toBe(true);
  });

  it("is off when the crew is not this board", () => {
    expect(isOffRota(wrongBoard)).toBe(true);
  });

  it("is on when the rota covers both", () => {
    expect(isOffRota(on)).toBe(false);
  });

  it("is not off when no rota is recorded", () => {
    // Unknown is not off. Guessing overtime for the people whose rota nobody filled in
    // would pay them for it — LUIS FERMINO PERREIRA JUNIOR has no rota and was on the
    // same Friday night as the ten.
    expect(isOffRota(unknown)).toBe(false);
  });
});

describe("statusForPlacement", () => {
  it("marks an off-rota placement as overtime", () => {
    // The ten on Friday 07/08 night. Saved as assigned, paid as an ordinary night.
    expect(statusForPlacement("assigned", null, wrongDay)).toBe("overtime");
  });

  it("leaves an ordinary rostered day alone", () => {
    expect(statusForPlacement("assigned", null, on)).toBe("assigned");
  });

  it("keeps an overtime mark when somebody is dragged between areas", () => {
    // Overtime says how the day counts; the area says where they are. Moving them
    // changes only the second.
    expect(statusForPlacement("assigned", "overtime", on)).toBe("overtime");
  });

  it("never rewrites an away status", () => {
    for (const s of ["holiday", "sick", "unpaid"] as const) {
      expect(statusForPlacement(s, null, wrongDay)).toBe(s);
      expect(statusForPlacement(s, "overtime", wrongDay)).toBe(s);
    }
  });

  it("does not turn an off-rota placement into overtime when the rota is unknown", () => {
    expect(statusForPlacement("assigned", null, unknown)).toBe("assigned");
  });

  it("moves somebody back off overtime is still a manual act", () => {
    // Dropping onto an area cannot clear overtime, so the only way back is the status
    // control itself — which passes a status other than "assigned".
    expect(statusForPlacement("assigned", "overtime", wrongDay)).toBe("overtime");
  });
});
