import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MyMeeting } from "@/lib/meetings";
import { MeetingAgenda } from "./MeetingCalendar";

const m = (id: string, starts: string, ends: string, over: Partial<MyMeeting> = {}) =>
  ({ id, title: `Meeting ${id}`, starts_at: starts, ends_at: ends, location: null, my_response: "accepted", cancelled_at: null, ...over }) as unknown as MyMeeting;

describe("MeetingAgenda — what the floor sees instead of an empty week", () => {
  it("says there is nothing coming up, in words", () => {
    render(<MeetingAgenda meetings={[]} today="2026-11-26" onOpen={() => {}} />);
    expect(screen.getByText("No meetings coming up")).toBeInTheDocument();
  });

  it("groups by day, Today and Tomorrow by name, and opens a meeting", () => {
    const onOpen = vi.fn();
    render(<MeetingAgenda today="2026-11-26" onOpen={onOpen} meetings={[
      m("b", "2026-11-27T09:00:00Z", "2026-11-27T09:30:00Z"),
      m("a", "2026-11-26T14:00:00Z", "2026-11-26T14:30:00Z", { location: "Office" } as Partial<MyMeeting>),
      m("c", "2026-12-01T09:00:00Z", "2026-12-01T09:30:00Z"),
    ]} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["Today", "Tomorrow", "Tue 01/12"]);
    fireEvent.click(screen.getByText("Meeting a"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    expect(screen.getByText(/until 14:30 · Office/)).toBeInTheDocument();
  });
});
