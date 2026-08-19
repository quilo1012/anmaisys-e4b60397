/**
 * The leader's own scorecard, end to end from the keypad.
 *
 * The point of these is the gate, not the arithmetic — computeScorecard is tested on
 * its own in src/lib/leaderScorecard.test.ts. What has to hold here is that nothing
 * about a leader reaches the screen before a leader's PIN does, that a refusal from
 * the database is shown in words the floor can act on, and that the screen carries no
 * way to look up somebody else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();

/**
 * A query chain that answers empty however far it is followed.
 *
 * `.eq().order().order()` has to keep returning something chainable and end up
 * awaitable, which a plain Promise cannot do.
 */
const chain: Record<string, unknown> = {};
chain.eq = () => chain;
chain.order = () => chain;
chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        // The dated weights table. Answering the way a database without it answers is
        // the honest stand-in — production has not run 20260818090000 — and it is the
        // path `chooseWeights` is built for. Without this the weighting query threw,
        // and the card, which no longer draws a score before the weighting lands,
        // waited on it forever.
        in: () => Promise.resolve({
          data: null,
          error: { code: "42P01", message: 'relation "leader_scorecard_threshold" does not exist' },
        }),
        // The options list, which the card now reads to find out which labels gate the
        // period. Same stand-in and same reason as the weights above: unmocked, the
        // chain threw, the gate query never settled, and the card — which does not draw
        // a score it cannot compute correctly — waited on it forever.
        //
        // An empty list is the honest answer here, not a shortcut: it is what a database
        // with no gates configured returns, and these tests are not about gates.
        eq: () => chain,
        order: () => chain,
      }),
    }),
  },
}));

// The layout drags in the sidebar, realtime subscriptions and auth. None of that is
// what these tests are about.
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { getCurrentFactoryShift } from "@/lib/shifts";
import LeaderMyScorecardPage from "@/pages/dashboard/LeaderMyScorecardPage";

const EMPTY_PAYLOAD = {
  success: true,
  leader: { id: "l1", name: "Kleyve", line: "Line 3", lines: ["Line 3", "Line 4"] },
  period: { from: "2026-08-11", to: "2026-08-11", shift: "night" },
  actions: [], completes: [], sessions: [], rag: [], items: [], work_orders: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LeaderMyScorecardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * The OTP field is a single input behind four slots. Four digits submit on their own,
 * which is how it behaves under a thumb on the floor.
 */
const typePin = async (pin: string) => {
  const input = document.querySelector("input") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: pin } });
  });
};

/**
 * Let `input-otp`'s stray timers land while the environment still exists.
 *
 * The PIN keypad is an `OTPInput`, and input-otp schedules three timeouts — 0ms, 10ms
 * and 50ms — from a `useEffect` that returns no cleanup:
 *
 *     function syncTimeouts(cb) { setTimeout(cb, 0); setTimeout(cb, 10); setTimeout(cb, 50) }
 *     useEffect(() => { syncTimeouts(() => { ...setState... }) }, [value, isFocused])
 *
 * So the 50ms one fires after the component is gone. It calls setState, React reaches
 * for `window`, and jsdom has already been torn down: `ReferenceError: window is not
 * defined`, reported as an uncaught exception. Every test PASSES and the run still exits
 * 1 — which is what CI does with `bun run test`, so the whole suite goes red over a
 * timer in a third-party component.
 *
 * This is not a workaround for a flaky test. The timers are real work the component
 * scheduled; waiting for them is letting it finish. Nothing here can fix the missing
 * cleanup — it is inside node_modules — and suppressing the error instead would hide
 * the next genuine one.
 *
 * 60ms clears the longest of the three. Paid once per test in one file.
 */
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60));
});

beforeEach(() => {
  rpc.mockReset();
});

describe("LeaderMyScorecardPage", () => {
  it("shows nothing but the keypad before a PIN is entered", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /my scorecard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open my scorecard/i })).toBeInTheDocument();
    // No score, no leader, no way to pick one.
    expect(screen.queryByText(/final score/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the PIN to the database and never a leader id", async () => {
    rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
    renderPage();
    await typePin("4821");

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("leader_self_scorecard");
    expect(args._pin).toBe("4821");
    expect(Object.keys(args)).not.toContain("_leader_id");
  });

  it("opens on the leader's own card once the PIN is accepted", async () => {
    rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
    renderPage();
    await typePin("4821");

    expect(await screen.findByRole("heading", { name: "Kleyve" })).toBeInTheDocument();
    expect(screen.getByText(/final score/i)).toBeInTheDocument();
    // Both lines they lead, so they can see the card covers all of them.
    expect(screen.getByText("Line 3")).toBeInTheDocument();
    expect(screen.getByText("Line 4")).toBeInTheDocument();
  });

  it("offers this shift and this month, and no other period", async () => {
    rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
    renderPage();
    await typePin("4821");

    await screen.findByRole("heading", { name: "Kleyve" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent(/this shift/i);
    expect(tabs[1]).toHaveTextContent(/this month/i);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("asks the database again, for the month, when the month is chosen", async () => {
    rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
    renderPage();
    await typePin("4821");

    await screen.findByRole("heading", { name: "Kleyve" });
    rpc.mockClear();
    fireEvent.click(screen.getAllByRole("tab")[1]);

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const args = (rpc.mock.calls[0] as [string, Record<string, string>])[1];
    expect(args._shift).toBe("all");
    expect(args._from).toMatch(/-01$/);      // the first of the month
    expect(args._to).not.toBe(args._from);   // …through to today
  });

  it("says what a wrong PIN was, and how many tries are left", async () => {
    rpc.mockResolvedValue({ data: { success: false, error: "invalid_pin", remaining: 3 }, error: null });
    renderPage();
    await typePin("0000");

    expect(await screen.findByText(/incorrect pin\. 3 attempts left/i)).toBeInTheDocument();
    expect(screen.queryByText(/final score/i)).not.toBeInTheDocument();
  });

  it("tells an engineer their PIN is the wrong kind, rather than counting it against them", async () => {
    rpc.mockResolvedValue({ data: { success: false, error: "not_a_leader", engineer_name: "Murilo" }, error: null });
    renderPage();
    await typePin("1234");

    expect(await screen.findByText(/murilo is an engineer pin, not a line leader's/i)).toBeInTheDocument();
  });

  it("holds the keypad shut while the database says it is locked", async () => {
    rpc.mockResolvedValue({ data: { success: false, error: "locked", locked_seconds: 30, remaining: 0 }, error: null });
    renderPage();
    await typePin("0000");

    expect(await screen.findByText(/too many attempts\. wait 30s/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wait 30s/i })).toBeDisabled();
  });

  /**
   * This screen is opened on a line tablet, on a phone in a pocket, and on an office
   * desktop, and it has to be usable on all three. jsdom performs no layout and loads
   * no Tailwind, so — as in wo-buttons-a11y.test.tsx — these guard the classes that
   * carry the behaviour rather than the pixels they produce.
   */
  describe("on a tablet, a phone and a desktop", () => {
    it("gives the keypad targets a gloved thumb can hit", async () => {
      renderPage();
      // WCAG 2.5.5 asks for 44×44. The slots are 56 and the button 48. Scoped by
      // border-input so the lock badge above them, which is also h-14, is not counted.
      const slots = document.querySelectorAll(".h-14.w-14.border-input");
      expect(slots).toHaveLength(4);
      expect(screen.getByRole("button", { name: /open my scorecard/i }).className).toMatch(/\bh-12\b/);
    });

    it("caps its width instead of fixing it, so a desktop does not get a stretched column", async () => {
      rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
      renderPage();
      await typePin("4821");
      await screen.findByRole("heading", { name: "Kleyve" });

      // Asserted as "there is a cap", not as which cap: the exact value is a design
      // decision that moved once already (3xl → 5xl, when the figure rows turned out
      // to be sharing four columns of nothing on a desktop) and will move again.
      const page = document.querySelector(".mx-auto.w-full[class*='max-w-']") as HTMLElement;
      expect(page, "the card has no width cap at all").toBeTruthy();
      expect(page.className).toMatch(/\bw-full\b/);
      expect(page.className).toMatch(/\bmx-auto\b/);
      // A width in pixels anywhere on the page is a width that will be wrong on one
      // of the three devices.
      expect(page.outerHTML).not.toMatch(/style="[^"]*width:\s*\d+px/);
    });

    it("wraps the header instead of pushing Print and Export off the edge", async () => {
      rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
      renderPage();
      await typePin("4821");
      await screen.findByRole("heading", { name: "Kleyve" });

      // This is exactly how the manager's dialog once lost the same two buttons.
      const print = screen.getByRole("button", { name: /print/i });
      const header = print.closest(".flex-wrap");
      expect(header).toBeTruthy();
      expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
    });

    it("keeps the period buttons tappable and lets their labels run onto a second line", async () => {
      rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
      renderPage();
      await typePin("4821");
      await screen.findByRole("heading", { name: "Kleyve" });

      for (const tab of screen.getAllByRole("tab")) {
        expect(tab.className).toMatch(/\bmin-h-11\b/);      // 44px, however long the label
        expect(tab.className).toMatch(/whitespace-normal/); // "This month · August" must not clip
      }
    });

    it("stacks the figures two-up on a phone and four-up above it", async () => {
      // Needs a period that actually holds something. An empty one now says so in a
      // sentence instead of printing Total actions 0, Open 0, % closed 0% and a dash —
      // so there is no figure row to measure, which is the point of that change.
      rpc.mockResolvedValue({
        data: {
          ...EMPTY_PAYLOAD,
          // Dated now, and tagged with the shift now falls in: the default tab is
          // "this shift", derived from the real clock, and an action outside it is
          // filtered out before it ever reaches the card.
          actions: [{
            id: "a1", status: "todo", severity: "high", recorded_at: new Date().toISOString(),
            labels: [], department: "Quality", line: "Line 3", action_no: "QA-1",
            description: "Batch code mismatch",
            shift: getCurrentFactoryShift().shiftCode === "day" ? "DAY" : "NIGHT",
            validation_status: "open",
            validated_at: null, validated_by: null, attachments: null, closed_at: null,
          }],
        },
        error: null,
      });
      renderPage();
      await typePin("4821");
      await screen.findByText(/total actions/i);

      const grid = screen.getByText(/total actions/i).closest(".grid") as HTMLElement;
      expect(grid.className).toMatch(/grid-cols-2/);
      expect(grid.className).toMatch(/sm:grid-cols-4/);
    });
  });

  it("locks back to the keypad, and forgets the leader, when Lock is pressed", async () => {
    rpc.mockResolvedValue({ data: EMPTY_PAYLOAD, error: null });
    renderPage();
    await typePin("4821");

    await screen.findByRole("heading", { name: "Kleyve" });
    fireEvent.click(screen.getByRole("button", { name: /^lock$/i }));

    expect(await screen.findByRole("button", { name: /open my scorecard/i })).toBeInTheDocument();
    expect(screen.queryByText("Kleyve")).not.toBeInTheDocument();
  });
});
