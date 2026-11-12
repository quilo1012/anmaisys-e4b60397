import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MeetingCalendar } from "./MeetingCalendar";
import { dayKeyOf } from "@/lib/meetings";

describe("MeetingCalendar", () => {
  it("draws the line for now on today only", () => {
    const today = dayKeyOf(new Date());
    const { container } = render(<MeetingCalendar view="week" anchor={today} today={today} meetings={[]} onOpen={() => {}} />);
    expect(container.querySelectorAll(".bg-destructive.h-0\\.5")).toHaveLength(1);
  });

  it("draws no line on a week without today", () => {
    const { container } = render(<MeetingCalendar view="week" anchor="2020-01-08" today="2026-11-12" meetings={[]} onOpen={() => {}} />);
    expect(container.querySelectorAll(".bg-destructive.h-0\\.5")).toHaveLength(0);
  });

  it("whoever cannot schedule gets no slot buttons", () => {
    const { queryAllByRole } = render(<MeetingCalendar view="month" anchor="2026-11-12" today="2026-11-12" meetings={[]} onOpen={() => {}} />);
    expect(queryAllByRole("button")).toHaveLength(0);
  });
});
