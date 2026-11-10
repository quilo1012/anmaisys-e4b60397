import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MyMeeting } from "@/lib/meetings";

let role = "admin";
let mobile = false;
let meetings: MyMeeting[] = [];

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role, user: { id: "me" } }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));
vi.mock("@/components/meetings/MeetingFormDialog", () => ({
  MeetingFormDialog: ({ open, slot }: { open: boolean; slot?: { day: string; time: string } | null }) =>
    open ? <div data-testid="form">{slot ? `${slot.day} ${slot.time}` : "edit"}</div> : null,
}));
vi.mock("@/components/meetings/MeetingDetails", () => ({
  MeetingDetails: ({ meeting }: { meeting: MyMeeting | null }) => (meeting ? <div data-testid="details">{meeting.title}</div> : null),
}));
vi.mock("@/hooks/useMeetings", () => ({
  isNotInstalled: () => false,
  useMeetingsInRange: () => ({ data: meetings, error: null }),
  useMeeting: () => ({ data: null }),
}));

import MeetingsPage from "./MeetingsPage";
import { dayKeyOf, londonInstant } from "@/lib/meetings";

const today = dayKeyOf(new Date());
const at = (time: string) => londonInstant(today, time).toISOString();
const meeting = (over: Partial<MyMeeting>): MyMeeting => ({
  id: "m1", series_id: "s1", title: "Line review", description: null, starts_at: at("10:00"), ends_at: at("10:30"),
  location: "Office", video_link: null, recurrence: "none", recurrence_until: null, created_by: "admin",
  cancelled_at: null, my_response: "pending", ...over,
});

const mount = () => render(<MemoryRouter><MeetingsPage /></MemoryRouter>);

describe("MeetingsPage", () => {
  beforeEach(() => { role = "admin"; mobile = false; meetings = [meeting({})]; });

  it("opens on the week, with previous / today / next and the three views", () => {
    mount();
    expect(screen.getByRole("radio", { name: "Week" }).getAttribute("data-state")).toBe("on");
    for (const n of ["Previous", "Today", "Next"]) expect(screen.getByRole("button", { name: n })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Day" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Month" })).toBeTruthy();
  });

  it("draws the meeting as a block that says my answer, and opens it", () => {
    mount();
    const block = screen.getByRole("button", { name: /Line review, 10:00 to 10:30, Not answered/ });
    fireEvent.click(block);
    expect(screen.getByTestId("details").textContent).toBe("Line review");
  });

  it("a cancelled meeting is struck through", () => {
    meetings = [meeting({ cancelled_at: new Date().toISOString() })];
    mount();
    expect(screen.getByRole("button", { name: /Cancelled/ }).className).toContain("line-through");
  });

  it("the admin gets New meeting, and an empty slot opens the form at that time", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
    expect(screen.getByTestId("form").textContent).toBe(`${today} 09:00`);
  });

  it("anybody else sees no New meeting and cannot click a slot", () => {
    role = "employee";
    mount();
    expect(screen.queryByRole("button", { name: "New meeting" })).toBeNull();
    expect(screen.queryByRole("button", { name: /New meeting on/ })).toBeNull();
  });

  it("on a phone shows the day as a list, not the grid", () => {
    mobile = true;
    mount();
    expect(screen.queryByRole("radio", { name: "Week" })).toBeNull();
    expect(screen.getByText("Line review")).toBeTruthy();
    expect(screen.getByText(/10:00–10:30 · Office/)).toBeTruthy();
  });
});
