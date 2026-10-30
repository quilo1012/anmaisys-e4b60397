/**
 * Why somebody came in late or went home early (BLOCO 139), asked for on 30/10/2026: the
 * board could say Talita Melech went home at 11:00 and nothing about why.
 *
 * The box sits under the time it explains, only while that time is set, and saves once —
 * when it is left or Enter is pressed — never a write per key.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PersonDayDialog, LATE_EARLY_REASONS } from "@/components/workforce/PersonDayDialog";
import type { ShiftPattern } from "@/hooks/useWorkforce";
import type { HeadcountArea } from "@/hooks/useHeadcount";

const gelPacking: HeadcountArea = {
  id: "a1", name: "Gel Packing", kind: "production", section: "production", department: null,
  sort_order: 1, active: true,
};
const weekendRota: ShiftPattern = {
  id: "p-we", name: "Fri–Mon days", days: [5, 6, 7, 1], active: true,
  starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 60,
};

function open(props: Partial<React.ComponentProps<typeof PersonDayDialog>> = {}) {
  const onSetLeftEarlyReason = vi.fn();
  const onSetArrivedLateReason = vi.fn();
  const view = render(
    <PersonDayDialog
      open onOpenChange={() => {}} name="Talita Melech" shiftGroup="Weekend" status="assigned"
      areaId="a1" areas={[gelPacking]} canManage isLeader={false}
      halfDay={false} onSetHalfDay={() => {}}
      leftEarlyAt="11:00" onSetLeftEarlyAt={() => {}}
      arrivedLateAt={null} onSetArrivedLateAt={() => {}}
      leftEarlyReason={null} onSetLeftEarlyReason={onSetLeftEarlyReason}
      arrivedLateReason={null} onSetArrivedLateReason={onSetArrivedLateReason}
      patterns={[weekendRota]} patternId="p-we"
      onSetStatus={() => {}} onSetArea={() => {}} onSetShift={() => {}} onSetPattern={() => {}}
      onSetLeader={() => {}} onRemove={() => {}}
      {...props}
    />,
  );
  return { onSetLeftEarlyReason, onSetArrivedLateReason, ...view };
}

describe("the reason for a late start or an early finish", () => {
  it("is asked under the time it explains, only while that time is set", () => {
    open();
    expect(screen.getByLabelText("Reason for leaving early")).toBeInTheDocument();
    // No late start recorded, so no reason for one.
    expect(screen.queryByLabelText("Reason for arriving late")).not.toBeInTheDocument();
  });

  it("saves once, when the box is left — not a write per key", () => {
    const { onSetLeftEarlyReason } = open();
    const box = screen.getByLabelText("Reason for leaving early");
    fireEvent.change(box, { target: { value: "D" } });
    fireEvent.change(box, { target: { value: "Doctor's appointment" } });
    expect(onSetLeftEarlyReason).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onSetLeftEarlyReason).toHaveBeenCalledTimes(1);
    expect(onSetLeftEarlyReason).toHaveBeenCalledWith("Doctor's appointment");
  });

  it("saves on Enter too, trimmed", () => {
    const { onSetArrivedLateReason } = open({ arrivedLateAt: "07:00" });
    const box = screen.getByLabelText("Reason for arriving late");
    fireEvent.change(box, { target: { value: "  Transport / traffic  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSetArrivedLateReason).toHaveBeenCalledWith("Transport / traffic");
    // Leaving the box straight after is the same reason: no second write.
    fireEvent.blur(box);
    expect(onSetArrivedLateReason).toHaveBeenCalledTimes(1);
  });

  it("does not write when nothing changed, and clears with an empty box", () => {
    const { onSetLeftEarlyReason } = open({ leftEarlyReason: "Felt unwell" });
    const box = screen.getByLabelText("Reason for leaving early") as HTMLInputElement;
    expect(box.value).toBe("Felt unwell");
    fireEvent.blur(box);
    expect(onSetLeftEarlyReason).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    expect(onSetLeftEarlyReason).toHaveBeenCalledWith(null);
  });

  it("offers the common reasons to pick from, and keeps within what the database stores", () => {
    open();
    const box = screen.getByLabelText("Reason for leaving early") as HTMLInputElement;
    const list = document.getElementById(box.getAttribute("list")!)!;
    expect([...list.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([...LATE_EARLY_REASONS]);
    expect(box.maxLength).toBe(300);
  });

  it("is read only for somebody who cannot change the board", () => {
    open({ canManage: false, leftEarlyReason: "Family emergency" });
    expect(screen.getByLabelText("Reason for leaving early")).toBeDisabled();
  });

  it("is not offered by a caller that cannot save it", () => {
    open({ onSetLeftEarlyReason: undefined });
    expect(screen.queryByLabelText("Reason for leaving early")).not.toBeInTheDocument();
  });
});
