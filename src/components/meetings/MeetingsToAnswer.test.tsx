import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MyMeeting } from "@/lib/meetings";

let upcoming: MyMeeting[] = [];
const mutate = vi.fn();
vi.mock("@/hooks/useMeetings", () => ({
  useUpcomingMeetings: () => ({ data: upcoming }),
  useMeetingActions: () => ({ respond: { mutate, isPending: false } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MeetingsToAnswer } from "./MeetingsToAnswer";

const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const meeting = (over: Partial<MyMeeting>): MyMeeting => ({
  id: "m1", series_id: "s1", title: "Line review", description: null, starts_at: soon(24), ends_at: soon(25),
  location: null, video_link: null, recurrence: "none", recurrence_until: null, created_by: "admin",
  cancelled_at: null, my_response: "pending", ...over,
});

describe("MeetingsToAnswer", () => {
  beforeEach(() => { mutate.mockReset(); upcoming = [meeting({}), meeting({ id: "m2", title: "Safety walk", my_response: "accepted" })]; });

  it("lists only the meetings I have not answered", () => {
    render(<MeetingsToAnswer onOpen={() => {}} />);
    expect(screen.getByRole("heading", { name: "Waiting for your answer (1)" })).toBeTruthy();
    expect(screen.getByText("Line review")).toBeTruthy();
    expect(screen.queryByText("Safety walk")).toBeNull();
  });

  it("draws nothing when there is nothing to answer", () => {
    upcoming = [meeting({ my_response: "accepted" })];
    const { container } = render(<MeetingsToAnswer onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("accepts on the row", () => {
    render(<MeetingsToAnswer onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept Line review" }));
    expect(mutate.mock.calls[0][0]).toEqual({ id: "m1", response: "accepted", reason: undefined });
  });

  it("asks for an optional reason before declining, and sends it", () => {
    render(<MeetingsToAnswer onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline Line review" }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "  On holiday " } });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(mutate.mock.calls[0][0]).toEqual({ id: "m1", response: "declined", reason: "On holiday" });
  });

  it("opens the meeting from its title", () => {
    const onOpen = vi.fn();
    render(<MeetingsToAnswer onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /^Line review/ }));
    expect(onOpen.mock.calls[0][0].id).toBe("m1");
  });
});
