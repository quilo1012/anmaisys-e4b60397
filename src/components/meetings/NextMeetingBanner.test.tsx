import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MyMeeting } from "@/lib/meetings";

let upcoming: MyMeeting[] = [];
vi.mock("@/hooks/useMeetings", () => ({ useUpcomingMeetings: () => ({ data: upcoming }) }));

import { NextMeetingBanner } from "./NextMeetingBanner";

const NOW = new Date("2026-11-12T09:50:00Z"); // 09:50 in London (GMT in November)
const at = (mins: number) => new Date(NOW.getTime() + mins * 60_000).toISOString();
const meeting = (over: Partial<MyMeeting>): MyMeeting => ({
  id: "m1", series_id: "s1", title: "Line review", description: null, starts_at: at(40), ends_at: at(70),
  location: "Office", video_link: "https://teams.microsoft.com/l/x", recurrence: "none", recurrence_until: null,
  created_by: "admin", cancelled_at: null, my_response: "accepted", ...over,
});

describe("NextMeetingBanner", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("is quiet more than 15 minutes before", () => {
    upcoming = [meeting({})];
    render(<NextMeetingBanner onOpen={() => {}} />);
    expect(screen.getByText("Starts in 40 min")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your next meeting" }).className).not.toContain("bg-primary ");
  });

  it("fills with the primary colour from 15 minutes before, with Join", () => {
    upcoming = [meeting({ starts_at: at(10), ends_at: at(40) })];
    render(<NextMeetingBanner onOpen={() => {}} />);
    expect(screen.getByText("Starts in 10 min")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your next meeting" }).className).toContain("bg-primary");
    expect(screen.getByRole("link", { name: /Join/ }).getAttribute("href")).toBe("https://teams.microsoft.com/l/x");
  });

  it("draws nothing when the next meeting is after tomorrow", () => {
    upcoming = [meeting({ starts_at: at(3 * 24 * 60), ends_at: at(3 * 24 * 60 + 30) })];
    const { container } = render(<NextMeetingBanner onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("opens the meeting from its title", () => {
    upcoming = [meeting({})];
    const onOpen = vi.fn();
    render(<NextMeetingBanner onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Line review/ }));
    expect(onOpen.mock.calls[0][0].id).toBe("m1");
  });
});
