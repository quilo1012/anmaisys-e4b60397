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
    charges: {},
    woRequests: [],
    woStopped: 0,
    quality: {
      total: 0, completed: 0, filed: 0, open: 0, pctClosed: 0,
      sev: { critical: 0, high: 0, medium: 0, low: 0 },
      avgResolution: null, topLabels: [], trend: [],
    },
    docs: { penalised: [], pending: [], rejected: [], score: 100, impactPct: 0, penaltyPct: 5, pendingImpactPct: 0 },
    safety: { total: 0, rejected: 0, byKind: {}, occurrences: [] },
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
    // "up to −10%" used to be asserted here. It was the wrong number and, worse, the
    // wrong SIGN — see "what a verdict on pending paperwork actually does" below.
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
    // Scoped to the score panel. The Health & Safety band below it now prints on every
    // card, and its footnote explains what a ceiling IS — which is not the same as a
    // card claiming one fired. The panel is where that claim would be made.
    renderBody();
    const panel = screen.getByRole("region", { name: /final score/i });
    expect(within(panel).queryByText(/ceiling/i)).not.toBeInTheDocument();
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
    const panel = screen.getByRole("region", { name: /final score/i });
    expect(within(panel).getByText(/Score ceiling/i)).toBeInTheDocument();
    // The number that was lost, struck through, beside the one that replaced it.
    expect(within(panel).getByText("97%")).toBeInTheDocument();
    // Scoped: the band's footnote names a lost-time injury too, as the thing that WOULD
    // fire a ceiling. Only the panel says one actually did.
    expect(within(panel).getByText(/lost-time injury/i)).toBeInTheDocument();
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

/**
 * The card must say ONE thing about a pillar it is not scoring.
 *
 * When Quality has not ruled on any paperwork action, `computeLeaderScore` returns
 * `documentation.value === null` and its weight is shared out. The card then printed
 * three sentences about the same fact, and two of them were wrong together:
 *
 *   basis   "2 paperwork actions awaiting a verdict — not scored until one is given"
 *   pending "Validating them moves the charge here: −2% documentation"   ← a discount
 *           on a pillar that is not being scored
 *   dropped "Documentation is not counted — there was nothing to measure it on"
 *           ← false. There are two actions. They are unjudged, which is not the same
 *           as absent, and it is the difference the whole `null` exists to record.
 *
 * "Nothing to measure it on" is the right sentence for a period with no production
 * target. It is the wrong sentence here, and a leader who reads it will believe they
 * had no paperwork errors.
 */
describe("Documentation when no paperwork has a verdict", () => {
  const pendingAction = {
    id: "p1", status: "todo", severity: "low", recorded_at: "2026-08-05T10:00:00Z",
    labels: ["Paperwork"], department: null, line: "Line 1", action_no: "QA-9",
    description: "missing signature", shift: "DAY", validation_status: "open",
    validated_at: null, validated_by: null, attachments: null, closed_at: null,
  };

  const unscored = () => makeResult({
    docs: {
      penalised: [], pending: [pendingAction, { ...pendingAction, id: "p2", action_no: "QA-10" }],
      rejected: [], score: 100, impactPct: 0, penaltyPct: 2, pendingImpactPct: 4,
    },
    score: {
      production: { value: 100, basis: "Actual against target, capped at 100%" },
      quality: { value: 86, basis: "100 less 14 severity points from 4 actions" },
      documentation: {
        value: null,
        basis: "2 paperwork actions awaiting a verdict from Quality — not scored until one is given",
      },
      final: 93, cap: null, scales: null,
      applied: { production_pct: 53, quality_pct: 47, documentation_pct: 0 },
    },
  } as never);

  it("never says there was nothing to measure it on", () => {
    renderBody(unscored());
    expect(screen.queryByText(/nothing to measure/i)).not.toBeInTheDocument();
  });

  it("explains it once, naming where the charge actually sits", () => {
    renderBody(unscored());
    // Scoped to the score panel: the Documentation section lower down legitimately
    // says "paperwork" too, and this test is about the panel that carries the
    // arithmetic — the one that was printing two answers to the same question.
    const panel = screen.getByRole("region", { name: /final score/i });
    const notes = within(panel).getAllByText(/paperwork/i).filter((n) => n.tagName === "P");
    expect(notes).toHaveLength(1);
    // The three facts a leader needs to check the 93: the pillar is unscored, its
    // weight went somewhere, and the actions are being charged in the meantime.
    expect(notes[0].textContent).toMatch(/not scored|not counted/i);
    expect(notes[0].textContent).toMatch(/shared/i);
    expect(notes[0].textContent).toMatch(/quality/i);
    expect(notes[0].textContent).toMatch(/2%/);
  });

  it("keeps the ordinary pending note when the pillar IS scored", () => {
    // One validated error means the pillar has a measurement, so it scores — and the
    // note goes back to being about what validating the rest would do.
    const scored = makeResult({
      docs: {
        penalised: [{ ...pendingAction, id: "v1", validation_status: "validated" }],
        pending: [{ ...pendingAction, id: "p2" }],
        rejected: [], score: 98, impactPct: 2, penaltyPct: 2, pendingImpactPct: 2,
      },
      score: {
        production: { value: 100, basis: "Actual against target, capped at 100%" },
        quality: { value: 86, basis: "100 less 14 severity points from 3 actions" },
        documentation: { value: 98, basis: "100 less 2% for each of 1 validated paperwork error" },
        final: 95, cap: null, scales: null,
        applied: { production_pct: 40, quality_pct: 35, documentation_pct: 25 },
      },
    } as never);
    renderBody(scored);
    expect(screen.getByText(/awaiting a verdict/i).textContent).toMatch(/gives it back/i);
    expect(screen.queryByText(/nothing to measure/i)).not.toBeInTheDocument();
  });
});

/**
 * Health & Safety, on the card, without becoming a fourth weight.
 *
 * The band exists because the score is silent about H&S until somebody is hurt badly
 * enough to fire the ceiling — so a leader whose team reported nine near misses and ran
 * four toolbox talks reads a card that never mentions safety, and a leader with a first
 * aid case reads one that never mentions it either. Neither is scored, and neither
 * should be; both have to be on the page the leader signs.
 *
 * The one rule the band may not break is the one `SAFETY_KIND_GROUPS` exists to state:
 * harm, signal and prevention are not degrees of the same thing and are never summed.
 * Zero near misses is under-reporting, not a safe line.
 */
describe("the Health & Safety band", () => {
  const occurrence = (kind: string, id: string) => ({
    id, status: "todo", severity: null, recorded_at: "2026-08-05T10:00:00Z",
    labels: [], department: null, line: "Line 6", action_no: null,
    description: kind, shift: "DAY", validation_status: "open",
    validated_at: null, validated_by: null, attachments: null, closed_at: null,
    domain: "safety", safety_kind: kind,
  });

  const withSafety = (kinds: string[]) => makeResult({
    safety: {
      total: kinds.length,
      rejected: 0,
      byKind: kinds.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}),
      occurrences: kinds.map((k, i) => occurrence(k, `s${i}`)),
    },
  } as never);

  it("prints three sentences, not six tiles reading zero, when nothing was reported", () => {
    // This used to assert the section was ABSENT, on the reasoning that six tiles
    // reading 0 are nine pieces of furniture for one fact and the fact is good news.
    // The reasoning was right about the tiles and wrong about the section, and the
    // band itself says why: an empty signal column is the one figure on this card that
    // is bad news for being low — "under-reporting, not a safe line" — and hiding the
    // whole band made that sentence unreachable in the only case it describes. The
    // furniture stays gone; the words stay.
    renderBody(makeResult({ safety: { total: 0, rejected: 0, byKind: {}, occurrences: [] } } as never));
    const band = screen.getByRole("region", { name: /health & safety/i });
    expect(within(band).getByText(/nobody was hurt/i)).toBeInTheDocument();
    expect(within(band).getByText(/under-reporting/i)).toBeInTheDocument();
    expect(within(band).getByText(/nothing recorded/i)).toBeInTheDocument();
    expect(within(band).queryByText("0")).not.toBeInTheDocument();
  });

  it("counts each kind under its own group", () => {
    renderBody(withSafety(["first_aid", "near_miss", "near_miss", "toolbox_talk"]));
    expect(screen.getByRole("heading", { name: /health & safety/i })).toBeInTheDocument();
    const band = screen.getByRole("region", { name: /health & safety/i });
    expect(within(band).getByText("First aid").parentElement?.textContent).toMatch(/1/);
    expect(within(band).getByText("Near miss").parentElement?.textContent).toMatch(/2/);
    expect(within(band).getByText("Toolbox talk").parentElement?.textContent).toMatch(/1/);
  });

  it("never prints a total across the three groups", () => {
    // A "4" here is the one number this band must not offer: it adds a first aid case
    // to two near misses and calls the sum safety performance.
    const band = (renderBody(withSafety(["first_aid", "near_miss", "near_miss", "toolbox_talk"])),
      screen.getByRole("region", { name: /health & safety/i }));
    expect(within(band).queryByText(/^total/i)).not.toBeInTheDocument();
  });

  it("says a near miss reported is the good outcome", () => {
    renderBody(withSafety(["near_miss"]));
    const band = screen.getByRole("region", { name: /health & safety/i });
    expect(within(band).getByText(/arrived in time/i)).toBeInTheDocument();
  });

  it("states that none of it scores, and what does happen instead", () => {
    renderBody(withSafety(["first_aid"]));
    const band = screen.getByRole("region", { name: /health & safety/i });
    expect(within(band).getByText(/not scored/i).textContent).toMatch(/ceiling/i);
    expect(within(band).getByText(/not scored/i).textContent).toMatch(/49/);
  });
});

/**
 * The Documentation section still described the world before the charge moved.
 *
 * Three claims in one small amber box, written when a pending paperwork error was
 * charged nowhere and the pillar was always scored:
 *
 *   "No penalty yet"          — there is no penalty because there is no SCORE. The
 *                               pillar is null and its 25% has been shared out.
 *   "so nothing is charged"   — flatly false since d107199a. An open paperwork action
 *                               is charged, in the quality pillar, and the panel two
 *                               blocks above now says so in as many words.
 *   "would cost up to −4%"    — not a cost. Measured on two low-severity paperwork
 *                               actions priced at 2%: open scores 98, validated scores
 *                               99. A verdict RAISES the final score, because quality
 *                               gives back more than documentation takes.
 *
 * 33b3ce58 fixed "the three places that still said it doubled" and named them: the note
 * under the score, qualityScore's comment, and ControlCentreHome. This box was a fourth
 * and was not on the list.
 */
describe("the Documentation section agrees with the panel above it", () => {
  const pendingAction = {
    id: "p1", status: "todo", severity: "low", recorded_at: "2026-08-05T10:00:00Z",
    labels: ["Paperwork"], department: null, line: "Line 1", action_no: "QA-9",
    description: "missing signature", shift: "DAY", validation_status: "open",
    validated_at: null, validated_by: null, attachments: null, closed_at: null,
  };

  const unjudged = () => makeResult({
    docs: {
      penalised: [], pending: [pendingAction, { ...pendingAction, id: "p2", action_no: "QA-10" }],
      rejected: [], score: 100, impactPct: 0, penaltyPct: 2, pendingImpactPct: 4,
    },
    score: {
      production: { value: 100, basis: "Actual against target, capped at 100%" },
      quality: { value: 96, basis: "100 less 4 severity points from 2 actions" },
      documentation: {
        value: null,
        basis: "2 paperwork actions awaiting a verdict from Quality — not scored until one is given",
      },
      final: 98, cap: null, scales: null,
      applied: { production_pct: 53, quality_pct: 47, documentation_pct: 0 },
    },
  } as never);

  const section = () => screen.getByRole("region", { name: /documentation errors/i });

  it("never says nothing is charged", () => {
    renderBody(unjudged());
    expect(within(section()).queryByText(/nothing is charged/i)).not.toBeInTheDocument();
  });

  it("never prices a verdict as a cost", () => {
    renderBody(unjudged());
    expect(within(section()).queryByText(/would cost/i)).not.toBeInTheDocument();
  });

  it("says the pillar is not scored, rather than that it carries no penalty", () => {
    renderBody(unjudged());
    expect(within(section()).getByText(/not scored/i)).toBeInTheDocument();
    expect(within(section()).queryByText(/no penalty yet/i)).not.toBeInTheDocument();
  });

  it("names where the charge sits while the verdict is outstanding", () => {
    renderBody(unjudged());
    const body = within(section()).getByText(/quality score/i).textContent ?? "";
    expect(body).toMatch(/charged/i);
    // And says what a verdict does to it: moves it, at the configured price.
    expect(body).toMatch(/moves|transfer/i);
    expect(body).toMatch(/2%/);
    expect(body).not.toMatch(/5%/);
  });

  it("still reads 100% compliant when nothing was raised at all", () => {
    renderBody();
    expect(screen.getByText(/100% compliant/i)).toBeInTheDocument();
  });
});

/**
 * Half the quality log describes itself in a different column. All 66 safetyculture
 * rows carry `title` and none of the 69 `pm` rows do, so a card reading only
 * `description` says "No description recorded" about 54 of the 135 actions in the
 * base. Only 2 hold neither, and those are the rows the sentence is for.
 *
 * `title` leads because on the 14 rows carrying both it is the fault — "Black Residue
 * on Scoops (L1)" — while `description` is the product and batch that it happened to.
 */
describe("an action that was written into the title", () => {
  const base = {
    id: "t1", status: "todo", severity: null, recorded_at: "2026-09-02T10:00:00Z",
    labels: [], department: null, line: "Line 3", action_no: "QA-77",
    description: null, shift: "DAY", validation_status: null,
    validated_at: null, validated_by: null, attachments: null, closed_at: null,
  };

  const withActions = (over: Record<string, unknown>) =>
    makeResult({ actions: [{ ...base, ...over }] } as never);

  it("reads the title when there is no description", () => {
    renderBody(withActions({ title: "Black Residue on Scoops (L1)" }));
    expect(screen.getByText("Black Residue on Scoops (L1)")).toBeInTheDocument();
    expect(screen.queryByText(/no description recorded/i)).not.toBeInTheDocument();
  });

  it("names the row by the title and files the batch code under it", () => {
    // This asserted the batch code was nowhere on the page, which was the right idea
    // said too strongly. What must not happen is the row being NAMED by a product code;
    // the batch itself is the evidence that makes the fault checkable, and the Quality
    // dialog has always shown it for that reason. It is the subordinate line here, in
    // the muted size, never the headline.
    renderBody(withActions({
      title: "Missing closing time (L1)",
      description: "Basix Oats Coconut 3Kg / T26244 / 09-2026 09-2028",
    }));
    const headline = screen.getByText("Missing closing time (L1)");
    expect(headline).toBeInTheDocument();
    expect(headline.className).toMatch(/text-sm/);
    const detail = screen.getByText(/T26244/);
    expect(detail.className).toMatch(/text-2xs/);
    expect(detail.className).toMatch(/muted/);
  });

  it("still reads the description on a row typed on the Quality screen", () => {
    renderBody(withActions({ description: "Seal replaced on the filler" }));
    expect(screen.getByText("Seal replaced on the filler")).toBeInTheDocument();
  });

  it("falls through to the error type when neither carries text", () => {
    renderBody(withActions({ title: "   ", error_type: "Contamination risk" }));
    expect(screen.getByText("Contamination risk")).toBeInTheDocument();
  });

  it("falls through to the labels when there is no error type either", () => {
    renderBody(withActions({ title: null, labels: ["Paperwork", "CCP"] }));
    expect(screen.getByText("Paperwork · CCP")).toBeInTheDocument();
  });

  it("keeps saying nothing was recorded when the row genuinely holds nothing", () => {
    renderBody(withActions({ title: null }));
    expect(screen.getByText(/no description recorded/i)).toBeInTheDocument();
  });
});

/**
 * What state a row reports, and where it reads it from.
 *
 * The list keyed every state decision off `closed_at` — the Open/Complete badge, the
 * two filter chips, the divider between the groups and the sort. That column is NULL
 * on all 135 rows in the base and no code path in this repo writes it, so the answer
 * was the same on every row: 37 actions at `status = 'complete'` were each badged
 * "Open", directly under a Quality block that had just printed "% closed 43% · 3 of 7
 * completed" from `status`. One card, two sources, and the one a reader scans was the
 * dead one.
 *
 * `status` is the column the Quality screen writes and the score already counts, and
 * it holds three states rather than two — see QUALITY_STATUSES.
 */
describe("the state a row reports", () => {
  const base = {
    id: "s1", status: "todo", severity: null, recorded_at: "2026-09-02T10:00:00Z",
    labels: [], department: null, line: "Line 4", action_no: null,
    description: null, title: "Wrong batch code (L4)", shift: "DAY",
    validation_status: "open", validated_at: null, validated_by: null,
    attachments: null, closed_at: null,
  };
  const withActions = (...over: Array<Record<string, unknown>>) =>
    makeResult({ actions: over.map((o, i) => ({ ...base, id: `s${i}`, ...o })) } as never);

  it("reads Complete off the status, on a row no one ever stamped closed", () => {
    renderBody(withActions({ status: "complete", closed_at: null }));
    const list = screen.getByRole("region", { name: /actions in this period/i });
    expect(within(list).getByText(/^complete$/i)).toBeInTheDocument();
    expect(within(list).queryByText(/^open$/i)).not.toBeInTheDocument();
  });

  it("keeps In progress apart from To do rather than calling both Open", () => {
    renderBody(withActions({ status: "in_progress" }, { status: "todo" }));
    const list = screen.getByRole("region", { name: /actions in this period/i });
    expect(within(list).getByText(/^in progress$/i)).toBeInTheDocument();
    expect(within(list).getByText(/^to do$/i)).toBeInTheDocument();
  });

  it("counts the filter chips off the status too", () => {
    // Seven rows so the chips render at all, four of them finished.
    renderBody(withActions(
      ...Array.from({ length: 4 }, () => ({ status: "complete" })),
      ...Array.from({ length: 3 }, () => ({ status: "todo" })),
    ));
    expect(screen.getByRole("button", { name: /^complete 4$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^open 3$/i })).toBeInTheDocument();
  });

  it("does not print a uuid where the action was never given a number", () => {
    // `action_no` is null on 115 of the 135 rows, so the row led its own metadata with
    // eight characters of a uuid — a reference that identifies the record in no screen,
    // no export and no conversation.
    renderBody(withActions({ id: "3f2a91bc-0000-4000-8000-000000000000", action_no: null }));
    const list = screen.getByRole("region", { name: /actions in this period/i });
    expect(within(list).queryByText(/3f2a91bc/)).not.toBeInTheDocument();
  });

  it("still prints the number on the rows that have one", () => {
    renderBody(withActions({ action_no: "AC-6189" }));
    expect(screen.getByText(/AC-6189/)).toBeInTheDocument();
  });

  it("carries the batch the fault happened to, under the fault", () => {
    // The 14 rows holding both: `title` is what went wrong and `description` is the
    // product and batch it went wrong on. The list showed one and dropped the other,
    // so a leader could read the fault and not which run it came off.
    renderBody(withActions({
      title: "Missing closing time (L1)",
      description: "Basix Oats Coconut 3Kg / T26244 / 09-2026",
    }));
    expect(screen.getByText("Missing closing time (L1)")).toBeInTheDocument();
    expect(screen.getByText(/T26244/)).toBeInTheDocument();
  });

  it("does not repeat the headline underneath itself", () => {
    renderBody(withActions({ title: null, description: "Unsealed Tubes (L4)\n" }));
    expect(screen.getAllByText("Unsealed Tubes (L4)")).toHaveLength(1);
  });
});

describe("a row that has only its labels to be named by", () => {
  const base = {
    id: "L1", status: "complete", severity: "medium", recorded_at: "2026-07-25T10:00:00Z",
    labels: ["Bag Inside blender"], department: null, line: "Line 4", action_no: "AC-6171",
    description: null, title: null, shift: "DAY", validation_status: "open",
    validated_at: null, validated_by: null, attachments: null, closed_at: null,
  };

  it("does not print the label again as its own metadata", () => {
    // "Bag Inside blender" as the headline and "Bag Inside blender" again on the line
    // below it is one fact rendered twice — and the second reads as a second fact.
    renderBody(makeResult({ actions: [base] } as never));
    expect(screen.getAllByText(/Bag Inside blender/)).toHaveLength(1);
  });

  it("still carries the labels on a row that has a headline of its own", () => {
    renderBody(makeResult({ actions: [{ ...base, title: "Unsealed Tubes (L4)", labels: ["GMP"] }] } as never));
    expect(screen.getByText(/GMP/)).toBeInTheDocument();
  });
});

/**
 * What an action cost, and what it did not.
 *
 * The card exists to explain a number a person is appraised on, and the list of the
 * actions behind that number was silent about the arithmetic. 112 of the 135 actions
 * in the base carry no grade, and an ungraded action with no priced label charges
 * zero — so "no points deducted" and "nobody ever assessed this" printed identically.
 */
describe("what each action charged", () => {
  const base = {
    id: "c1", status: "todo", severity: "high", recorded_at: "2026-09-02T10:00:00Z",
    labels: [], department: null, line: "Line 6", action_no: "AC-1",
    description: null, title: "Excessive Powder Leakage hopper (L6)", shift: "DAY",
    validation_status: "open", validated_at: null, validated_by: null,
    attachments: null, closed_at: null, domain: "quality",
  };
  const withCharge = (charge: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    makeResult({
      actions: [{ ...base, ...over }],
      charges: { c1: { charged: 0, worth: 0, counted: true, reason: "counted", ...charge } },
    } as never);

  it("prints the points the action charged", () => {
    renderBody(withCharge({ charged: 4, worth: 4 }));
    const list = screen.getByRole("region", { name: /actions in this period/i });
    expect(within(list).getByText(/^4$/)).toBeInTheDocument();
  });

  it("says WHY a row cost nothing instead of printing a zero", () => {
    // A near miss priced at zero and an action worth four points that was voided are
    // not the same fact, and neither is "this leader was charged 0".
    renderBody(withCharge({ charged: 0, worth: 4, counted: false, reason: "rejected" }));
    expect(screen.getByText("voided")).toBeInTheDocument();
  });

  it("never calls a safety occurrence unattributable", () => {
    // Zero pricing exists so reporting a hazard cannot cost the reporter. "Not
    // attributable" turns that into an argument about blame.
    renderBody(withCharge({ charged: 0, worth: 0, counted: false, reason: "safety" }, { domain: "safety" }));
    expect(screen.getByText("not scored")).toBeInTheDocument();
    expect(screen.queryByText(/not theirs/i)).not.toBeInTheDocument();
  });

  it("says once, in words, that a period deducted nothing because nothing was graded", () => {
    renderBody(withCharge({ charged: 0, worth: 0, counted: true, reason: "counted" }, { severity: null }));
    expect(screen.getByText(/charged nothing/i)).toBeInTheDocument();
    expect(screen.getByText(/no grade and no priced label/i)).toBeInTheDocument();
  });

  it("puts the total charged beside the heading", () => {
    renderBody(withCharge({ charged: 4, worth: 4 }));
    expect(screen.getByText(/4 points charged/i)).toBeInTheDocument();
  });
});

/**
 * Who may grade from the card.
 *
 * The leader's own copy is opened on a line tablet that is signed in as the LINE, not
 * as a person. A grade written there would be unattributable — and the one field it
 * changes is the field that decides the score of whoever is holding the tablet.
 */
describe("grading from the card", () => {
  const base = {
    id: "g1", status: "todo", severity: null, recorded_at: "2026-09-02T10:00:00Z",
    labels: [], department: null, line: "Line 6", action_no: "AC-1",
    description: null, title: "Table broken (L6/maintenance)", shift: "DAY",
    validation_status: "open", validated_at: null, validated_by: null,
    attachments: null, closed_at: null, domain: "quality",
  };
  const result = (over: Record<string, unknown> = {}) => makeResult({
    actions: [{ ...base, ...over }],
    charges: { g1: { charged: 0, worth: 0, counted: true, reason: "counted" } },
  } as never);

  const renderWith = (onGrade?: () => Promise<void>, over: Record<string, unknown> = {}) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <LeaderScorecardBody leaderName="Ailton" period={PERIOD} result={result(over)} onGrade={onGrade} />
      </QueryClientProvider>,
    );
  };

  it("offers no grade control on a copy that was given no way to save one", () => {
    renderWith(undefined);
    expect(screen.queryByLabelText(/^grade /i)).not.toBeInTheDocument();
  });

  it("offers one where the session may write it", () => {
    renderWith(async () => undefined);
    expect(screen.getByLabelText(/^grade AC-1$/i)).toBeInTheDocument();
  });

  it("does not offer to grade a safety occurrence", () => {
    // It scores 0 however it is graded — the picker would be a control with no effect.
    renderWith(async () => undefined, { domain: "safety", safety_kind: "near_miss" });
    expect(screen.queryByLabelText(/^grade /i)).not.toBeInTheDocument();
  });

  it("keeps the grade readable as text for the printed page", () => {
    // A signed sheet is paper. A dropdown prints as an empty box.
    renderWith(async () => undefined);
    const printed = screen.getByText("Unrated");
    expect(printed.className).toMatch(/print:block/);
  });
});

/**
 * Where the reference sits, and what a row says when it has none.
 *
 * `action_no` is NULL on 115 of the 135 actions and the two absences are different
 * facts. One typed on the Quality screen may never have been given a number; a
 * SafetyCulture action always has one — `unique_id`, "A-1042" — that this database
 * does not hold yet.
 */
describe("the reference on a row", () => {
  const base = {
    id: "r1", status: "todo", severity: null, recorded_at: "2026-09-04T10:00:00Z",
    labels: [], department: null, line: "Line 5", action_no: null, source: "pm",
    description: null, title: "Missing informations on checklist (L5)", shift: null,
    validation_status: "open", validated_at: null, validated_by: null,
    attachments: null, closed_at: null, domain: "quality",
  };
  const withRow = (over: Record<string, unknown>) => makeResult({
    actions: [{ ...base, ...over }],
    charges: { r1: { charged: 0, worth: 0, counted: true, reason: "counted" } },
  } as never);

  it("leads the metadata with the number, not trails it", () => {
    renderBody(withRow({ action_no: "AC-6189" }));
    const line = screen.getByText(/AC-6189/).closest("p")!;
    expect(line.textContent).toMatch(/^AC-6189 · 04\/09/);
  });

  it("sets a real number as a figure, because it gets typed in somewhere else", () => {
    renderBody(withRow({ action_no: "AC-6189" }));
    expect(screen.getByText("AC-6189").className).toMatch(/font-figure/);
  });

  it("names the system a SafetyCulture row's number lives in while the field is empty", () => {
    renderBody(withRow({ source: "safetyculture", action_no: null }));
    expect(screen.getByText("SafetyCulture")).toBeInTheDocument();
  });

  it("shows the imported number the moment the import carries one", () => {
    // Nothing in this component changes for that — only the row does.
    renderBody(withRow({ source: "safetyculture", action_no: "A-1042" }));
    expect(screen.getByText("A-1042")).toBeInTheDocument();
    expect(screen.queryByText("SafetyCulture")).not.toBeInTheDocument();
  });

  it("does not dress the system name as a reference", () => {
    renderBody(withRow({ source: "safetyculture", action_no: null }));
    expect(screen.getByText("SafetyCulture").className).not.toMatch(/font-figure/);
  });

  it("says nothing where a hand-typed row simply has no number", () => {
    // The tablet's projection has no `source` at all until the migration lands, and an
    // undefined source must read as "no reference", never as a guess.
    renderBody(withRow({ source: undefined, action_no: null }));
    const line = screen.getByText(/04\/09/).closest("p")!;
    expect(line.textContent).toBe("04/09 · Line 5");
  });
});

/**
 * The band that could not print the one sentence it was written for.
 *
 * `SafetyBand` carries three empty states, and the middle one is emphatic: "Nothing
 * reported — which reads as under-reporting, not as a safe line." It is the only
 * figure on the card that is bad news for being low, and it was unreachable in exactly
 * the case it describes. The band rendered on `safety.total > 0`, so a period where
 * NOTHING was reported — no near miss, no toolbox talk, no first aid — printed no
 * Health & Safety section at all.
 *
 * A leader signs this page. A page that says nothing about safety says the shift was
 * safe, and a shift that reported nothing is the one nobody can vouch for.
 */
describe("Health & Safety is on every card", () => {
  it("prints the section on a period that reported nothing", () => {
    renderBody(makeResult({ safety: { total: 0, rejected: 0, byKind: {}, occurrences: [] } } as never));
    expect(screen.getByRole("heading", { name: /health & safety/i })).toBeInTheDocument();
  });

  it("says an empty signal column is under-reporting, not a safe line", () => {
    renderBody(makeResult({ safety: { total: 0, rejected: 0, byKind: {}, occurrences: [] } } as never));
    const band = screen.getByRole("region", { name: /health & safety/i });
    expect(within(band).getByText(/under-reporting/i)).toBeInTheDocument();
  });

  it("still says plainly that nobody was hurt", () => {
    // The good news is said once, in words, and not as three tiles reading 0.
    renderBody(makeResult({ safety: { total: 0, rejected: 0, byKind: {}, occurrences: [] } } as never));
    const band = screen.getByRole("region", { name: /health & safety/i });
    expect(within(band).getByText(/nobody was hurt/i)).toBeInTheDocument();
  });

  it("never prints a total across the three groups, empty or not", () => {
    renderBody(makeResult({ safety: { total: 0, rejected: 0, byKind: {}, occurrences: [] } } as never));
    const band = screen.getByRole("region", { name: /health & safety/i });
    expect(within(band).queryByText(/^total/i)).not.toBeInTheDocument();
  });
});

/**
 * What "100% compliant" is allowed to mean.
 *
 * The demerit is scoped to ONE label — `DOCUMENTATION_LABEL`, "Paperwork" — and the
 * green box read "No penalty · 100% compliant" over a period holding an action whose
 * own `error_type` says "Incomplete checklist". Measured on 09/09/2026: 53 actions
 * carry a classified `error_type`, nine of them name a paperwork failure outright
 * (Missing signature or time, Check not recorded, Missing check on spec, Incomplete
 * checklist) and ZERO of the 135 rows in the base carry the Paperwork label — the
 * import writes none, and the two classification rules that catch those failures set
 * an `error_type` and leave `label` NULL.
 *
 * The number is not wrong. The claim on top of it is: a block that has judged nothing
 * must not print a compliance figure, which is the same mistake the box beside it
 * already exists to prevent.
 */
describe("the documentation block does not vouch for what it never saw", () => {
  const action = (over: Record<string, unknown> = {}) => ({
    id: "d1", status: "todo", severity: "low", recorded_at: "2026-09-04T10:00:00Z",
    labels: [], department: null, line: "Line 5", action_no: null, source: "safetyculture",
    description: null, title: "Missing informations on checklist (L5)", shift: null,
    validation_status: "open", validated_at: null, validated_by: null,
    attachments: null, closed_at: null, domain: "quality", ...over,
  });

  it("does not claim compliance over a period whose actions were never labelled", () => {
    renderBody(makeResult({
      actions: [action()],
      charges: { d1: { charged: 2, worth: 2, counted: true, reason: "counted" } },
    } as never));
    expect(screen.queryByText(/100% compliant/i)).not.toBeInTheDocument();
  });

  it("says what the demerit is actually scoped to", () => {
    renderBody(makeResult({
      actions: [action()],
      charges: { d1: { charged: 2, worth: 2, counted: true, reason: "counted" } },
    } as never));
    expect(screen.getByText(/Paperwork label/i)).toBeInTheDocument();
  });

  it("still says 100% compliant when the period genuinely held no action at all", () => {
    // Nothing happened is a real, clean answer and keeps its plain words.
    renderBody();
    expect(screen.getByText(/100% compliant/i)).toBeInTheDocument();
  });

  it("hands a labelled action awaiting a verdict to the box that already says so", () => {
    // A Paperwork action Quality has not ruled on is a different state again, and the
    // card has had words for it since d107199a. The new box must not swallow it.
    const pending = action({ labels: ["Paperwork"] });
    renderBody(makeResult({
      actions: [pending],
      charges: { d1: { charged: 2, worth: 2, counted: true, reason: "counted" } },
      docs: { penalised: [], pending: [pending], rejected: [], score: 100, impactPct: 0, penaltyPct: 5, pendingImpactPct: 0 },
    } as never));
    // Scoped: the Quality section says "under review" too, about the same action.
    const block = screen.getByRole("region", { name: /documentation errors/i });
    expect(within(block).getByText(/under review/i)).toBeInTheDocument();
    expect(within(block).queryByText(/nothing scored here/i)).not.toBeInTheDocument();
  });
});
