import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { StoredNotification } from "@/lib/notificationFeed";

/**
 * The bell reads the rows the server writes. It used to keep only what happened while
 * the tab was open, so an overtime ask published at 05:00 was nowhere by 07:00.
 */
const toast = vi.hoisted(() => Object.assign(vi.fn(), {
  info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "employee", user: { id: "me" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});

const markRead = { mutate: vi.fn() };
let feed: { notifications: StoredNotification[]; loaded: boolean; asks: Map<string, { id: string; status: string; on_date: string; starts_at: string }> };
vi.mock("@/hooks/useMyNotifications", () => ({ useMyNotifications: () => ({ ...feed, markRead }) }));

import { NotificationPanel } from "./NotificationPanel";

const row = (over: Partial<StoredNotification>): StoredNotification => ({
  id: "n1", title: "New overtime available", body: "Sat 24/10 · Day · 06:00–14:00 · need 2",
  priority: "medium", action_url: "/dashboard/my-overtime?ask=a1", wo_id: null, read_at: null,
  created_at: new Date().toISOString(), kind: "overtime_new", overtime_request_id: "a1", ...over,
});

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <NotificationPanel />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

const future = "2099-01-03";

describe("NotificationPanel — the stored bell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feed = { notifications: [], loaded: true, asks: new Map() };
  });

  it("counts unread stored rows on the bell", () => {
    feed.notifications = [row({ id: "n1" }), row({ id: "n2", read_at: new Date().toISOString(), overtime_request_id: "a2" })];
    mount();
    expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeTruthy();
  });

  it("shows the ask, whether it is still open, and opens it", () => {
    feed.notifications = [row({})];
    feed.asks = new Map([["a1", { id: "a1", status: "open", on_date: future, starts_at: "06:00:00" }]]);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /unread notifications/ }));
    expect(screen.getByText("New overtime available")).toBeTruthy();
    expect(screen.getByText("Sat 24/10 · Day · 06:00–14:00 · need 2")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    fireEvent.click(screen.getByText("New overtime available"));
    expect(markRead.mutate).toHaveBeenCalledWith(["n1"]);
    expect(screen.getByTestId("where").textContent).toBe("/dashboard/my-overtime?ask=a1");
  });

  it("says when the ask can no longer be taken", () => {
    feed.notifications = [row({})];
    feed.asks = new Map([["a1", { id: "a1", status: "cancelled", on_date: future, starts_at: "06:00:00" }]]);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /unread notifications/ }));
    expect(screen.getByText("No longer available")).toBeTruthy();
  });

  it("marks everything read", () => {
    feed.notifications = [row({})];
    mount();
    fireEvent.click(screen.getByRole("button", { name: /unread notifications/ }));
    fireEvent.click(screen.getByText("Mark all read"));
    expect(markRead.mutate).toHaveBeenCalledWith("all");
  });

  it("has an empty state", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "0 unread notifications" }));
    expect(screen.getByText("No notifications yet")).toBeTruthy();
  });

  it("does not toast what was already there when the page loaded, and toasts a new one once", () => {
    feed = { notifications: [], loaded: false, asks: new Map() };
    const view = mount();
    feed = { notifications: [row({ id: "old" })], loaded: true, asks: new Map() };
    view.rerender(
      <MemoryRouter><NotificationPanel /></MemoryRouter>,
    );
    expect(toast.info).not.toHaveBeenCalled();

    feed = { notifications: [row({ id: "new", overtime_request_id: "a9" }), row({ id: "old" })], loaded: true, asks: new Map() };
    view.rerender(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    expect(toast.info).toHaveBeenCalledTimes(1);

    view.rerender(<MemoryRouter><NotificationPanel /></MemoryRouter>);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });
});
