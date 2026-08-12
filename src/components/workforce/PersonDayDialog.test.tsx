/**
 * The day card, which is where the two ends of somebody's day get recorded.
 *
 * The arithmetic is tested next door in src/lib/partDay.test.ts. What has to hold here
 * is what a supervisor sees and what the card sends back: that a late start can be
 * marked at all, that the time it offers belongs to the person's own shift rather than
 * to a day crew, and that neither mark is offered on a day nobody came in for — the
 * board's own constraint refuses that row.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PersonDayDialog } from "@/components/workforce/PersonDayDialog";
import type { ShiftPattern } from "@/hooks/useWorkforce";
import type { HeadcountArea } from "@/hooks/useHeadcount";

const blenderRoom: HeadcountArea = {
  id: "a1", name: "Blender Room", kind: "support", section: "support", department: null,
  sort_order: 1, active: true,
};

/** Fri–Mon days: 06:00–18:00 with an hour's break, so eleven hours paid. */
const dayRota: ShiftPattern = {
  id: "p-day", name: "Fri–Mon days", days: [5, 6, 7, 1], active: true,
  starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 60,
};
/** Mon–Thu nights, which start in the evening. */
const nightRota: ShiftPattern = {
  id: "p-night", name: "Mon–Thu nights", days: [1, 2, 3, 4], active: true,
  starts_at: "18:00:00", ends_at: "06:00:00", break_minutes: 60,
};

function open(props: Partial<React.ComponentProps<typeof PersonDayDialog>> = {}) {
  const onSetArrivedLateAt = vi.fn();
  const onSetLeftEarlyAt = vi.fn();
  render(
    <PersonDayDialog
      open
      onOpenChange={() => {}}
      name="Josimar Inocente"
      shiftGroup="Weekend"
      status="assigned"
      areaId="a1"
      areas={[blenderRoom]}
      canManage
      isLeader={false}
      halfDay={false}
      onSetHalfDay={() => {}}
      leftEarlyAt={null}
      onSetLeftEarlyAt={onSetLeftEarlyAt}
      arrivedLateAt={null}
      onSetArrivedLateAt={onSetArrivedLateAt}
      patterns={[dayRota, nightRota]}
      patternId="p-day"
      onSetStatus={() => {}}
      onSetArea={() => {}}
      onSetShift={() => {}}
      onSetPattern={() => {}}
      onSetLeader={() => {}}
      onRemove={() => {}}
      {...props}
    />,
  );
  return { onSetArrivedLateAt, onSetLeftEarlyAt };
}

describe("PersonDayDialog — arriving late", () => {
  it("offers an hour into the person's own shift, not a fixed time", () => {
    // 06:00 start, so 07:00. A hard-coded default would put a day's time on a night's
    // card: 09:00 is a sensible late start on a day and a nonsense one on a night that
    // begins at six in the evening.
    const { onSetArrivedLateAt } = open();
    fireEvent.click(screen.getByRole("checkbox", { name: /arrived late/i }));
    expect(onSetArrivedLateAt).toHaveBeenCalledWith("07:00");
  });

  it("offers the evening on a night rota", () => {
    const { onSetArrivedLateAt } = open({ patternId: "p-night" });
    fireEvent.click(screen.getByRole("checkbox", { name: /arrived late/i }));
    expect(onSetArrivedLateAt).toHaveBeenCalledWith("19:00");
  });

  it("says what the late start cost once the time is on the card", () => {
    // Due at six, in at nine, stayed to the end: three hours missed of eleven.
    open({ arrivedLateAt: "09:00" });
    expect(screen.getByDisplayValue("09:00")).toBeInTheDocument();
    expect(screen.getByText(/8h worked/)).toBeInTheDocument();
    expect(screen.getByText(/3h unpaid/)).toBeInTheDocument();
  });

  it("counts one day, not two shortfalls, when both ends are marked", () => {
    // In at nine and home at two is one window of five hours, less the break he was
    // there for. Added up as two separate shortfalls it would deduct the break twice.
    open({ arrivedLateAt: "09:00", leftEarlyAt: "14:00" });
    expect(screen.getByText(/4h worked/)).toBeInTheDocument();
    expect(screen.getByText(/7h unpaid/)).toBeInTheDocument();
    // Once, under the time that ends the day, not printed against both boxes.
    expect(screen.getAllByText(/h unpaid/)).toHaveLength(1);
  });

  it("is not offered on a day nobody came in for", () => {
    // You cannot be late for a shift you were never at, and the table refuses the row:
    // `arrived_late_at` is only allowed beside assigned or overtime.
    open({ status: "holiday" });
    expect(screen.queryByRole("checkbox", { name: /arrived late/i })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /left early/i })).toBeNull();
  });

  it("records the time but says nothing about hours when there is no rota", () => {
    open({ arrivedLateAt: "09:00", patternId: null });
    expect(screen.getByDisplayValue("09:00")).toBeInTheDocument();
    expect(screen.queryByText(/h unpaid/)).toBeNull();
    expect(screen.getByText(/No rota on file/)).toBeInTheDocument();
  });

  it("cannot be changed by somebody who only reads the board", () => {
    open({ canManage: false, arrivedLateAt: "09:00" });
    expect(screen.getByRole("checkbox", { name: /arrived late/i })).toBeDisabled();
    expect(screen.getByDisplayValue("09:00")).toBeDisabled();
  });
});
