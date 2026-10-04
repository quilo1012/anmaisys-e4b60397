/**
 * When the start-of-shift team actually reaches the tablet.
 *
 * The popup was written against a fifteen-minute wall-clock window: it could only open
 * between 06:00 and 06:15, or 18:00 and 18:15, London. Nothing about it was tied to
 * the operator arriving. A tablet switched on at 06:20 — or a login at 07:00, or a
 * crew that starts late because the line was still being cleaned down — got the first
 * screen of the shift with no team on it, and no error either. The one moment the
 * roster is worth reading is the moment somebody first looks at the tablet, and that
 * moment is not on a clock.
 *
 * The dismissal key is already per-shift, so the window was never what kept the popup
 * from nagging: `an_shift_team_seen_<shift start>` does that, and does it correctly.
 * Dropping the window therefore costs nothing and buys the whole shift.
 *
 * What has to hold: it opens the first time the operator sees an operator screen in a
 * shift, whenever that is; it stays shut for the rest of that shift once acknowledged;
 * the next shift asks again; and a shift with nobody recorded on the line stays quiet
 * rather than opening an empty box.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const line = { selectedLineId: "line-3", selectedLineName: "Line 3" };
let team: unknown[] = [];
let querySucceeded = true;

vi.mock("@/contexts/DeviceLineContext", () => ({
  useDeviceLineCtx: () => line,
}));

vi.mock("@/hooks/useLineTeamBoard", () => ({
  useLineTeamBoard: () => ({ data: team, isSuccess: querySucceeded }),
}));

import { ShiftTeamPopup } from "./ShiftTeamPopup";

function member(name: string, extra: Record<string, unknown> = {}) {
  return {
    employee_name: name,
    display_name: name,
    sheet_start_time: null,
    sheet_tag: null,
    area_name: "Line 3",
    area_sort: 1,
    status: "assigned",
    is_leader: false,
    half_day: false,
    note: null,
    shift: "Day",
    on_date: "2026-10-05",
    ...extra,
  };
}

/**
 * Monday 5 October 2026 is British Summer Time, so London is UTC+1: the day shift
 * starts at 05:00Z and 05:40Z is forty minutes into it — well past the old window.
 */
const FORTY_MINUTES_IN = new Date("2026-10-05T05:40:00Z");
/** The same day's night shift, half an hour after its 18:00 London start. */
const NIGHT_HALF_HOUR_IN = new Date("2026-10-05T17:30:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  team = [member("Carlos Russo", { is_leader: true }), member("Lucas Gloor")];
  querySucceeded = true;
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ShiftTeamPopup", () => {
  it("opens for an operator who arrives well after the shift started", () => {
    vi.setSystemTime(FORTY_MINUTES_IN);

    render(<ShiftTeamPopup />);

    expect(screen.getByText("Carlos Russo")).toBeTruthy();
    expect(screen.getByText("Lucas Gloor")).toBeTruthy();
  });

  it("stays shut for the rest of the shift once acknowledged", () => {
    vi.setSystemTime(FORTY_MINUTES_IN);
    const first = render(<ShiftTeamPopup />);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    first.unmount();

    // Two hours later, same shift: the operator has already seen it.
    vi.setSystemTime(new Date("2026-10-05T07:40:00Z"));
    render(<ShiftTeamPopup />);

    expect(screen.queryByText("Carlos Russo")).toBeNull();
  });

  it("asks again on the next shift", () => {
    vi.setSystemTime(FORTY_MINUTES_IN);
    const day = render(<ShiftTeamPopup />);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    day.unmount();

    vi.setSystemTime(NIGHT_HALF_HOUR_IN);
    render(<ShiftTeamPopup />);

    expect(screen.getByText("Carlos Russo")).toBeTruthy();
  });

  it("stays quiet when nobody is recorded on the line", () => {
    vi.setSystemTime(FORTY_MINUTES_IN);
    team = [];

    render(<ShiftTeamPopup />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays quiet while the team has not been read yet", () => {
    vi.setSystemTime(FORTY_MINUTES_IN);
    querySucceeded = false;

    render(<ShiftTeamPopup />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
