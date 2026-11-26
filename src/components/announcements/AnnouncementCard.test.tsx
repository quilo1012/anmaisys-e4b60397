import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MyAnnouncement } from "@/lib/announcements";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const ack = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock("@/hooks/useAnnouncements", () => ({ useAcknowledgeAnnouncement: () => ack }));

import { AnnouncementCard } from "./AnnouncementCard";

const a = (over: Partial<MyAnnouncement> = {}): MyAnnouncement => ({
  id: "a1", title: "Company Closure – December 12",
  body: "Please be advised that the company will be closed on December 12.\nThis announcement applies to all weekend shift employees.",
  category: "company", urgent: false, requires_ack: true,
  published_at: "2026-11-26T10:00:00Z", expires_at: null,
  audience_department: "Production", audience_shift_group: "Weekend",
  read_at: null, acknowledged_at: null, ...over,
});

describe("AnnouncementCard — what the employee sees on the phone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a new announcement with the title, the full message, the date and the button", () => {
    render(<AnnouncementCard announcement={a()} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Company Closure – December 12" })).toBeInTheDocument();
    expect(screen.getByText(/applies to all weekend shift employees/)).toBeInTheDocument();
    expect(screen.getByText(/Published Thu 26 Nov 2026, 10:00 · Production · Weekend/)).toBeInTheDocument();
    expect(screen.getByText("Please acknowledge that you have read this announcement.")).toBeInTheDocument();
  });

  it("records the acknowledgment when the button is pressed", () => {
    render(<AnnouncementCard announcement={a()} />);
    fireEvent.click(screen.getByRole("button", { name: "I HAVE READ THIS ANNOUNCEMENT" }));
    expect(ack.mutate).toHaveBeenCalledWith("a1", expect.anything());
  });

  it("once confirmed, shows Read and when, and offers no button to press again", () => {
    render(<AnnouncementCard announcement={a({ read_at: "2026-11-26T10:05:00Z", acknowledged_at: "2026-11-26T10:05:00Z" })} />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.queryByRole("button", { name: /I HAVE READ/ })).toBeNull();
    expect(screen.getByText(/You confirmed you read this on Thu 26 Nov 2026, 10:05/)).toBeInTheDocument();
  });

  it("marks an urgent announcement", () => {
    render(<AnnouncementCard announcement={a({ urgent: true })} />);
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });
});
