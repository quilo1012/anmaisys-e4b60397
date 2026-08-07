import { describe, it, expect } from "vitest";
import { boardFromHistory, boardShiftForPerson } from "@/lib/boardForPerson";

const TODAY = "2026-08-07";
const row = (shift: string, on_date: string) => ({ shift, on_date });

describe("boardFromHistory", () => {
  it("puts a weekend-crew person on the board they are actually drawn on", () => {
    // Talita Melech's crew is Weekend and every day of her the factory has ever
    // planned sits on the Day board, because their sheets draw one day board for
    // everybody except nights.
    const rows = ["2026-08-03", "2026-08-04", "2026-08-05"].map((d) => row("Day", d));
    expect(boardFromHistory(rows, TODAY)).toBe("Day");
  });

  it("keeps the night crew on their own board", () => {
    expect(boardFromHistory([row("Night", "2026-08-05")], TODAY)).toBe("Night");
  });

  it("ignores history older than the window", () => {
    // Sixty days back: a board somebody left in the spring is not where they are now.
    expect(boardFromHistory([row("Weekend", "2026-01-04")], TODAY)).toBeNull();
  });

  it("breaks a tie towards the most recent", () => {
    const rows = [row("Weekend", "2026-07-20"), row("Day", "2026-08-05")];
    expect(boardFromHistory(rows, TODAY)).toBe("Day");
  });

  it("is null for somebody who has never been placed", () => {
    expect(boardFromHistory([], TODAY)).toBeNull();
  });
});

describe("boardShiftForPerson", () => {
  it("prefers where they have been over what their crew says", () => {
    // The whole point: the crew mapping sent her holiday to a board holding nothing
    // but her holiday, while the board everybody reads showed her missing.
    expect(boardShiftForPerson([row("Day", "2026-08-05")], TODAY, "Weekend")).toBe("Day");
  });

  it("falls back to the crew for a new starter", () => {
    expect(boardShiftForPerson([], TODAY, "Weekend")).toBe("Weekend");
  });

  it("returns null when neither knows, rather than guessing a board", () => {
    // The attendance record still carries the day; only the drawing is skipped.
    expect(boardShiftForPerson([], TODAY, null)).toBeNull();
  });
});
