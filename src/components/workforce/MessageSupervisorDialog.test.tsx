/**
 * The employee's side of the thread with the supervisor. The reply has to be findable
 * (a count on the button), read when opened, and each message says when it was sent
 * and — on your own — whether it has been seen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageSupervisorDialog } from "./MessageSupervisorDialog";
import { dmInboxPath } from "@/hooks/useDirectMessages";

const state = vi.hoisted(() => ({ unread: {} as Record<string, number>, markRead: vi.fn(), thread: [] as unknown[] }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "me" }, role: "employee" }) }));
vi.mock("@/hooks/useDirectMessages", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useDirectMessages")>()),
  useDMThread: (partner: string | null) => ({ data: partner ? state.thread : [], isLoading: false }),
  useDMUnreadBySender: () => ({ data: state.unread }),
  useMarkDMRead: () => ({ mutate: state.markRead }),
}));

const request = { id: "r1", on_date: "2026-10-20", starts_at: "06:00", ends_at: "14:00", created_by: "sup" };
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MessageSupervisorDialog request={request} fmtDate={(d) => d} />
  </QueryClientProvider>,
);

beforeEach(() => {
  state.unread = {}; state.markRead.mockReset();
  state.thread = [
    { id: "m1", sender_id: "me", sender_name: "Ana", recipient_id: "sup", message: "I'll be late", read_at: "2026-10-19T08:01:00Z", created_at: "2026-10-19T08:00:00Z", image_url: null, audio_url: null },
    { id: "m2", sender_id: "sup", sender_name: "Rui", recipient_id: "me", message: "Fine", read_at: null, created_at: "2026-10-19T08:05:00Z", image_url: null, audio_url: null },
  ];
});

describe("MessageSupervisorDialog", () => {
  it("shows unread replies on the button and reads them when opened", () => {
    state.unread = { sup: 2 };
    renderIt();
    expect(screen.getByLabelText("2 unread replies")).toBeInTheDocument();
    expect(state.markRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /message supervisor/i }));
    expect(state.markRead).toHaveBeenCalled();
  });

  it("does not mark anything read when nothing is unread", () => {
    renderIt();
    expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /message supervisor/i }));
    expect(state.markRead).not.toHaveBeenCalled();
  });

  it("dates every message and says when yours was seen", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /message supervisor/i }));
    expect(screen.getAllByRole("time")).toHaveLength(2);
    expect(screen.getByLabelText("Seen")).toBeInTheDocument();
  });
});

describe("dmInboxPath", () => {
  it("sends an employee to My Overtime, where their thread is, and everyone else to Messages", () => {
    expect(dmInboxPath("employee")).toBe("/dashboard/my-overtime");
    expect(dmInboxPath("manager")).toBe("/dashboard/messages");
  });
});
