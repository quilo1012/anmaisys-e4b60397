/**
 * The card itself, as a leader and their manager both read it.
 *
 * The arithmetic is tested in src/lib/leaderScorecard.test.ts. What has to hold here
 * is that the card does not lie about the arithmetic: that a figure is legible as the
 * number it is, that an empty period says it is empty instead of printing zeros, and
 * that the weighting a score was built from is on the page rather than in a footnote.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ScorecardPeriod, ScorecardResult } from "@/lib/leaderScorecard";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: [], error: null }) },
}));

// recharts measures its container, and jsdom reports every box as 0×0 — the chart
// renders nothing and warns. None of these tests are about the chart.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

import { LeaderScorecardBody } from "@/components/leader/LeaderScorecardBody";

const PERIOD: ScorecardPeriod = { from: "2026-08-01", to: "2026-08-13", shift: "all" };

function makeResult(over: Partial<ScorecardResult> = {}): ScorecardResult {
  return {
    actions: [],
    woRequests: [],
    woStopped: 0,
    quality: {
      total: 0, completed: 0, filed: 0, open: 0, pctClosed: 0,
      sev: { critical: 0, high: 0, medium: 0, low: 0 },
      avgResolution: null, topLabels: [], trend: [],
    },
    docs: { penalised: [], pending: [], rejected: [], score: 100, impactPct: 0, penaltyPct: 5, pendingImpactPct: 0 },
    production: {
      sessions: 8, avgOEE: null, downtimeH: null, runtimeH: null,
      output: 40648, attainment: 84, actualQty: 40648, targetQty: 48512,
      plannedSessions: 8, sessionsWithPlan: 8, plannedWithoutOutput: 0,
    },
    score: {
      production: { value: 83, basis: "Actual against target, capped at 100%" },
      quality: { value: 100, basis: "No quality actions raised in this period" },
      documentation: { value: 100, basis: "No validated paperwork error" },
      final: 93,
      cap: null,
      scales: null,
      applied: { production_pct: 40, quality_pct: 30, documentation_pct: 30 },
    },
    ...over,
  };
}

function renderBody(result: ScorecardResult = makeResult()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LeaderScorecardBody leaderName="Guilherme" period={PERIOD} result={result} />
    </QueryClientProvider>,
  );
}

describe("LeaderScorecardBody", () => {
  it("pins the locale so a total cannot be read as a decimal", () => {
    // `toLocaleString()` with no locale follows the browser, and on a Portuguese
    // machine that prints 40648 as "40.648" — on a card whose other figures are
    // percentages and a resolution time in days, a dot reads as a decimal point.
    // The rest of the app already pins the locale; this card was the exception.
    //
    // Asserted on the CALL, not on the rendered text: jsdom runs in en-US, where the
    // unpinned call already returns "40,648". A test reading the output would have
    // passed on the broken code and caught this only on the floor.
    const spy = vi.spyOn(Number.prototype, "toLocaleString");
    try {
      renderBody();
      expect(spy).toHaveBeenCalled();
      for (const [locale] of spy.mock.calls) {
        expect(locale, "a figure was formatted in whatever locale the tablet happens to be in").toBe("en-GB");
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("says the period is empty instead of printing a wall of zeros", () => {
    // With no action raised, the block printed Total actions 0, Open 0, % closed 0%,
    // Avg resolution —, and four severity badges reading 0. Nine pieces of furniture
    // for one fact. The fact is worth saying; the furniture is not.
    renderBody();
    const quality = screen.getByRole("region", { name: /quality/i });
    expect(within(quality).getByText(/no quality action was raised/i)).toBeInTheDocument();
    expect(within(quality).queryByText(/total actions/i)).not.toBeInTheDocument();
    expect(within(quality).queryByText(/avg resolution/i)).not.toBeInTheDocument();
  });

  it("never paints a nought as an achievement", () => {
    // `% closed` carried the earned tone unconditionally, so a leader who had closed
    // none of four open actions was shown a green 0% sitting on a green rule — the
    // rule that means "earned" everywhere else in the app.
    const result = makeResult({
      quality: {
        total: 4, completed: 0, filed: 0, open: 4, pctClosed: 0,
        sev: { critical: 0, high: 1, medium: 2, low: 1 },
        avgResolution: null, topLabels: [], trend: [],
      },
    });
    renderBody(result);
    const quality = screen.getByRole("region", { name: /quality/i });
    const closed = within(quality).getByText("0%");
    expect(closed.className).not.toMatch(/success/);
  });

  it("shows what the score is made of, sized by what each part counts for", () => {
    // The three components were three equal boxes with "weight 40%" written inside
    // one of them. Equal boxes say the parts are equal; they are 40/30/30. The bar
    // gives each part the width it actually carries, so the arithmetic is visible
    // rather than asserted — the leader this card is about has to be able to check it.
    renderBody();
    const bar = screen.getByRole("img", { name: /how this score was built/i });
    const segments = within(bar).getAllByRole("presentation");
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.style.flexGrow)).toEqual(["40", "30", "30"]);
    expect(bar).toHaveAccessibleName(/production 83% of 100, counting 40%/i);
  });

  it("drops a component from the bar when there was nothing to measure it on", () => {
    // A null component is not a zero: computeScorecard leaves it out and shares its
    // weight between the others. A segment drawn empty would read as a failure.
    const result = makeResult({
      score: {
        production: { value: null, basis: "No production session in this period" },
        quality: { value: 100, basis: "No quality actions raised in this period" },
        documentation: { value: 100, basis: "No validated paperwork error" },
        final: 100,
        cap: null,
      scales: null,
        applied: { production_pct: 0, quality_pct: 50, documentation_pct: 50 },
      },
    });
    renderBody(result);
    const bar = screen.getByRole("img", { name: /how this score was built/i });
    expect(within(bar).getAllByRole("presentation")).toHaveLength(2);
    expect(screen.getByText(/production is not counted/i)).toBeInTheDocument();
  });
  it("does not read 100% compliant while paperwork is still waiting for a verdict", () => {
    // Only a validated action penalises — that rule stands. But a green box saying
    // "No penalty · 100% compliant" over two unjudged cases is the card telling a
    // leader they are clean when nobody has looked yet.
    const pendingAction = {
      id: "p1", status: "todo", severity: "low", recorded_at: "2026-08-05T10:00:00Z",
      labels: ["Paperwork"], department: null, line: "Line 1", action_no: "QA-9",
      description: "missing signature", shift: "DAY", validation_status: "open",
      validated_at: null, validated_by: null, attachments: null, closed_at: null,
    };
    const result = makeResult({
      docs: {
        penalised: [], pending: [pendingAction, { ...pendingAction, id: "p2", action_no: "QA-10" }],
        rejected: [], score: 100, impactPct: 0, penaltyPct: 5, pendingImpactPct: 10,
      },
    } as never);
    renderBody(result);
    expect(screen.queryByText(/100% compliant/i)).not.toBeInTheDocument();
    expect(screen.getByText(/2 under review/i)).toBeInTheDocument();
    expect(screen.getByText(/up to −10%/i)).toBeInTheDocument();
  });

  it("still reads 100% compliant when there is nothing raised at all", () => {
    renderBody();
    expect(screen.getByText(/100% compliant/i)).toBeInTheDocument();
  });
  it("the pending note quotes the configured price, not a hard-coded 5%", () => {
    // The demerit reads the Paperwork label's price now. A sentence that still says
    // "−5%" would contradict the number printed two lines above it.
    const pendingAction = {
      id: "p1", status: "todo", severity: "low", recorded_at: "2026-08-05T10:00:00Z",
      labels: ["Paperwork"], department: null, line: "Line 1", action_no: "QA-9",
      description: "missing signature", shift: "DAY", validation_status: "open",
      validated_at: null, validated_by: null, attachments: null, closed_at: null,
    };
    const result = makeResult({
      docs: {
        penalised: [], pending: [pendingAction], rejected: [],
        score: 100, impactPct: 0, penaltyPct: 10, pendingImpactPct: 10,
      },
    } as never);
    renderBody(result);
    const note = screen.getByText(/awaiting a verdict/i);
    expect(note.textContent).toMatch(/10%/);
    expect(note.textContent).not.toMatch(/5%/);
    // And it must say the charge MOVES on validation, not that it piles on top.
    expect(note.textContent).toMatch(/instead of|moves to|rather than/i);
  });
});

/**
 * A ceiling nobody can see on the card is a score nobody can check.
 *
 * The whole reason H&S is a ceiling and not a 25% weight is that an injury must not be
 * purchasable with production volume — so when it fires, the card has to say that it
 * fired, what the score was before, and why. A leader shown 49 with no sight of the 97
 * it was cut from has been given a verdict, not a scorecard.
 */
describe("the H&S ceiling on the card", () => {
  const capped = (over: Record<string, unknown>) =>
    makeResult({
      score: {
        production: { value: 100, basis: "Actual against target, capped at 100%" },
        quality: { value: 92, basis: "100 less 8 severity points from 2 actions" },
        documentation: { value: 100, basis: "No validated paperwork error" },
        applied: { production_pct: 40, quality_pct: 35, documentation_pct: 25 },
        ...over,
      },
    } as never);

  it("says nothing at all when no occurrence gated the period", () => {
    renderBody();
    expect(screen.queryByText(/ceiling/i)).not.toBeInTheDocument();
  });

  it("shows the score it was cut from, and the one that stands", () => {
    renderBody(capped({
      final: 49,
      cap: { value: 49, applied: true, weighted: 97.2, reason: "A lost-time injury limits this score to 49%." },
    }));
    // "Score ceiling", not "Health & Safety ceiling". The heading stopped naming the
    // cause when a failed CCP became able to cap a period too — a heading that names the
    // wrong cause is the first thing a leader reads. What fired is on the reason line,
    // which is asserted below.
    expect(screen.getByText(/Score ceiling/i)).toBeInTheDocument();
    // The number that was lost, struck through, beside the one that replaced it.
    expect(screen.getByText("97%")).toBeInTheDocument();
    expect(screen.getByText(/lost-time injury/i)).toBeInTheDocument();
  });

  it("does not claim a limit it did not impose", () => {
    // The gate fired on a period already scoring below the ceiling. "Limited to 49"
    // would credit the ceiling with work it did not do — and the occurrence still has
    // to appear, or a bad week hides the injury in it.
    renderBody(capped({
      final: 31,
      cap: { value: 49, applied: false, weighted: 31, reason: "A lost-time injury limits this score to 49%." },
    }));
    expect(screen.getByText(/already scored below it/i)).toBeInTheDocument();
    expect(screen.getByText(/still stands on the record/i)).toBeInTheDocument();
  });
});
