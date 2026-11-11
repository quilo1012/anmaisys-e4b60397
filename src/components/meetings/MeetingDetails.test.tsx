import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MyMeeting } from "@/lib/meetings";
import type { ParticipantRow } from "@/hooks/useMeetings";

let rows: ParticipantRow[] = [];
const mutate = vi.fn();
vi.mock("@/hooks/useMeetings", () => ({
  useMeetingParticipants: () => ({ data: rows, isLoading: false, error: null }),
  useMeetingActions: () => ({ respond: { mutate, isPending: false }, cancel: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MeetingDetails } from "./MeetingDetails";

const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const meeting = (over: Partial<MyMeeting> = {}): MyMeeting => ({
  id: "m1", series_id: "s1", title: "Line review", description: null, starts_at: soon(24), ends_at: soon(25),
  location: null, video_link: null, recurrence: "none", recurrence_until: null, created_by: "admin",
  cancelled_at: null, my_response: "pending", ...over,
});
const mount = (m: MyMeeting) =>
  render(<MeetingDetails meeting={m} canManage={false} myId="me" onClose={() => {}} onEdit={() => {}} />);

describe("MeetingDetails", () => {
  beforeEach(() => {
    mutate.mockReset();
    rows = [
      { user_id: "a", name: "Ana", response: "accepted", responded_at: null },
      { user_id: "me", name: "Me", response: "pending", responded_at: null },
      { user_id: "c", name: "Cat", response: "declined", responded_at: null, decline_reason: "On holiday" },
    ];
  });

  it("counts the answers above the list", () => {
    mount(meeting());
    expect(screen.getByText("1 accepted · 1 declined · 1 not answered")).toBeTruthy();
  });

  it("shows a decline's reason when the database sends it", () => {
    mount(meeting());
    expect(screen.getByText("“On holiday”")).toBeTruthy();
  });

  it("shows my current answer in the header", () => {
    mount(meeting({ my_response: "accepted" }));
    expect(screen.getByText("Your answer: Accepted")).toBeTruthy();
  });

  it("Decline asks for a reason first, Accept answers at once", () => {
    mount(meeting());
    fireEvent.click(screen.getByRole("button", { name: /^Decline$/ }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Off sick" } });
    const buttons = screen.getAllByRole("button", { name: /^Decline$/ });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(mutate.mock.calls[0][0]).toEqual({ id: "m1", response: "declined", reason: "Off sick" });
  });
});
