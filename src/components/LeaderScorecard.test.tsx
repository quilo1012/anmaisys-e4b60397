/**
 * The scorecard when a read fails.
 *
 * A leader's card is a document about a person. The arithmetic living in
 * src/lib/leaderScorecard.ts is tested there; what has to hold here is narrower and
 * more important: when the card cannot read the quality log, it must say so, and it
 * must not score the period.
 *
 * This is not hypothetical. The `.select()` on quality_actions names `domain`, a column
 * that only exists once 20260817090000 is applied. Against a database without it,
 * PostgREST rejects the whole query with 42703, `useQuery` hands back undefined, the
 * `= []` default turns that into an empty array, and the card printed
 *
 *   "No quality action was raised against this leader in this period."
 *
 * alongside Quality 100% — weighted at 50% of a final score of 100%. Four open actions
 * existed. The failure did not lower the score, it raised it, and it did so in the one
 * document a leader is judged by. An empty read and an empty period are not the same
 * fact and must not print the same sentence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/** Which tables should fail this test. Reset per case. */
const failing = new Set<string>();
/** Rows a table should hand back when it does not fail. Reset per case. */
const rows = new Map<string, unknown[]>();
/** When set, any select naming `domain` fails the way a pre-20260817090000 base does. */
const state = { noDomainColumn: false };
/** Every filter the card applied, so a test can ask HOW a row was looked up. */
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

/**
 * A stand-in for the PostgREST builder: every filter returns the builder, and the
 * builder is itself awaitable — the component awaits some queries directly and others
 * after `.order()`, and both paths have to work.
 */
function builder(table: string) {
  let columns = "";
  const settle = () => {
    if (failing.has(table)) {
      return Promise.resolve({
        data: null,
        error: { code: "42703", message: `column ${table}.broken does not exist` },
      });
    }
    if (state.noDomainColumn && columns.includes("domain")) {
      return Promise.resolve({
        data: null,
        error: { code: "42703", message: `column ${table}.domain does not exist` },
      });
    }
    return Promise.resolve({ data: rows.get(table) ?? [], error: null });
  };

  const chain: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle().then(res, rej),
    select: (c?: string) => { columns = c ?? ""; return chain; },
    // The weights row is read with `.maybeSingle()`. Without it here the weighting
    // query threw, and the card — which now declines to draw a score before the
    // weighting lands — waited forever on a promise the harness never made.
    maybeSingle: () => settle().then((r: any) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data })),
  };
  for (const m of ["eq", "in", "gte", "lte", "ilike", "order", "limit", "not", "or"]) {
    chain[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return chain; };
  }
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

// The card refuses to draw until attribution is known, and that gate is not what is
// under test here — hold it open so a failure is the only reason the body can be absent.
vi.mock("@/hooks/useLabelAttribution", () => ({
  useLeaderAttribution: () => ({ excluded: new Set<string>(), ready: true }),
}));
vi.mock("@/hooks/useProfileNames", () => ({ useProfileNames: () => ({ data: [] }) }));

vi.mock("recharts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

import { LeaderScorecard } from "@/components/LeaderScorecard";

function draw(leaderName = "Ailton") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // The card links each action to its record in Quality, so it renders <Link> and
  // needs a router the way it has one in the app.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LeaderScorecard leaderName={leaderName} from="2026-08-01" to="2026-08-17" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * The card must find a leader's rows whatever case they were stored in.
 *
 * This repo spells the same person two ways and has done for months: `leader_pins`
 * holds HENRIQUE, CAINAN, FILIPI, KAZ and JULIANO in capitals while the production
 * tables hold Henrique, Cainan, Filipi, Kaz and Juliano. A quality action takes its
 * `leader_name` from `line_leaders`; a production session takes its own from the
 * tablet. Nothing guarantees the two agree about capitals.
 *
 * `.eq()` is case-sensitive, so the consequence was silent and one-sided: Cainan's
 * card found twelve production sessions and zero quality actions, and printed "No
 * quality action was raised against this leader in this period" over Quality 100% —
 * the same flattering sentence a failed read used to print, arrived at a different
 * way. A leader's worst month and their best look identical when the name does not
 * match.
 *
 * So the assertion is about the lookup, not the rows: no column carrying a human name
 * may be matched with `eq`.
 */
/**
 * An action on the card must be followable to its record.
 *
 * The list of actions a leader is scored on was plain text. A manager could read
 * "GMP Non-Compliance · −4" and had no route to the evidence, the history, or the
 * name of whoever validated it — the score asserted a penalty and offered nothing to
 * check it against. On a system aiming at BRCGS that is an audit trail with a gap in
 * the middle of it.
 */
describe("LeaderScorecard, following an action to its record", () => {
  beforeEach(() => {
    failing.clear();
    rows.clear();
    calls.length = 0;
    state.noDomainColumn = false;
  });

  it("links each action row to that action in Quality", async () => {
    rows.set("quality_actions", [
      {
        id: "11111111-2222-3333-4444-555555555555", status: "open", severity: "high",
        recorded_at: "2026-08-13T12:00:00Z", labels: ["GMP"], department: "Production",
        line: "Line 6", action_no: "QA-0042", description: "GMP Non-Compliance",
        shift: "DAY", validation_status: "open", validated_at: null, validated_by: null,
        attachments: null, closed_at: null, domain: "quality",
      },
    ]);
    draw();

    const link = await screen.findByRole("link", { name: /Open QA-0042 in Quality/i });
    expect(link).toHaveAttribute(
      "href",
      "/dashboard/quality?action=11111111-2222-3333-4444-555555555555",
    );
  });
});

describe("LeaderScorecard, matching the leader's name", () => {
  beforeEach(() => {
    failing.clear();
    rows.clear();
    calls.length = 0;
    state.noDomainColumn = false;
  });

  it("never matches a leader's name case-sensitively", async () => {
    draw("Cainan");
    await screen.findByText(/No quality action was raised against this leader/i);

    const byName = calls.filter((c) => c.args.some((a) => typeof a === "string" && /leader_name$/.test(a)));
    expect(byName.length).toBeGreaterThan(0);
    for (const c of byName) {
      expect(
        c.method,
        `${c.table} matched ${String(c.args[0])} with .${c.method}() — "CAINAN" would not be found`,
      ).not.toBe("eq");
    }
  });

  /**
   * The window, not the filter. `workOrdersInPeriod` can only throw back rows it was
   * given, and a call-out raised at 02:00 on the morning after `to` belongs to `to`'s
   * night — so the fetch has to reach that far, exactly as the quality log's does.
   *
   * Asserted here because at the pure-function level this case passes for the wrong
   * reason: the filter happily returns a row nobody ever read.
   */
  it("fetches work orders as far as the morning after, like the quality log", async () => {
    draw();
    await screen.findByText(/No quality action was raised against this leader/i);

    const bounds = calls.filter((c) => c.table === "work_orders" && c.method === "lte");
    expect(bounds.length).toBeGreaterThan(0);
    // 2026-08-17 + 1 day, to 06:59 UTC — the end of that night shift.
    expect(bounds.some((c) => String(c.args[1]).startsWith("2026-08-18T06:59:59"))).toBe(true);
  });

  it("looks the leader up on every table that holds their name", async () => {
    draw("Cainan");
    await screen.findByText(/No quality action was raised against this leader/i);

    const named = new Set(
      calls
        .filter((c) => c.args.some((a) => typeof a === "string" && /leader_name$/.test(a)))
        .map((c) => c.table),
    );
    expect(named).toContain("quality_actions");
    expect(named).toContain("production_sessions");
    expect(named).toContain("production_items");
  });
});

describe("LeaderScorecard, when a read fails", () => {
  beforeEach(() => {
    failing.clear();
    rows.clear();
    state.noDomainColumn = false;
  });

  it("does not report an empty period when the quality log could not be read", async () => {
    failing.add("quality_actions");
    draw();

    // The sentence that made the bug invisible. It is a statement about the log, and
    // the log was never read.
    expect(await screen.findByText("This scorecard could not be read.")).toBeInTheDocument();
    // and it names what is missing, so the reader is not left guessing
    expect(screen.getByText(/quality actions did not load/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/No quality action was raised against this leader/i),
    ).not.toBeInTheDocument();
  });

  /**
   * The same failure as the quality one, pointing the other way.
   *
   * `production_items` swallowed its own error and returned `[]`, so `eItems` — which
   * this component lists in `readFailed` and names in the message — could never become
   * true. A rejected read therefore produced actual = 0 against a RAG target that read
   * fine, which is attainment 0%, which is a Production pillar of ZERO weighted into
   * the final score as a measurement.
   *
   * A leader who ran a full month would be shown 0% production and a score to match,
   * with nothing on the card suggesting the number came from a broken query rather
   * than from their work. The quality bug flattered and so went unreported; this one
   * condemns, which is worse in a document somebody is judged by.
   *
   * Zero is a real reading. "The query failed" is not zero.
   */
  it("does not score a leader at zero when production items could not be read", async () => {
    failing.add("production_items");
    rows.set("production_sessions", [
      { oee_pct: 80, run_time_min: 600, down_time_min: 20, intouch_good_total: 1000,
        session_date: "2026-08-13", line: "Line 6", shift: "DAY" },
    ]);
    rows.set("rag_weekly_entries", [
      { entry_date: "2026-08-13", line: "Line 6", shift: "DAY", plan_qty: 5000 },
    ]);
    draw();

    expect(await screen.findByText("This scorecard could not be read.")).toBeInTheDocument();
    expect(screen.getByText(/production items did not load/i)).toBeInTheDocument();
    // The figure that would have been printed as the leader's month.
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("does not award a score built on a failed read", async () => {
    failing.add("quality_actions");
    draw();

    await screen.findByText("This scorecard could not be read.");
    // 100% is what the card showed for a leader with four open actions.
    expect(screen.queryByText("100")).not.toBeInTheDocument();
  });

  it("still reports a genuinely empty period as empty", async () => {
    draw();

    expect(
      await screen.findByText(/No quality action was raised against this leader/i),
    ).toBeInTheDocument();
  });

  /**
   * The case actually on screen on 17/08: the base predates 20260817090000, so the
   * select naming `domain` is rejected — but the rows are there and readable without
   * it. The card must show them. A database that has never heard of safety actions
   * has none, so every row it does hold is a quality action, which is exactly what
   * `actionPoints` concludes when `domain` is undefined.
   */
  it("reads the log without `domain` when the column has not been migrated yet", async () => {
    state.noDomainColumn = true;
    rows.set("quality_actions", [
      {
        id: "a1", status: "open", severity: null, recorded_at: "2026-08-13T12:00:00Z",
        labels: ["Maintenance", "GMP"], department: "Production", line: "Line 6",
        action_no: null, description: "GMP Non-Compliance", shift: "DAY",
        validation_status: "pending", validated_at: null, validated_by: null,
        attachments: null, closed_at: null,
      },
    ]);
    draw();

    // The figure grid only exists when the log was read and is not empty.
    expect(await screen.findByText("Total actions", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(
      screen.queryByText(/No quality action was raised against this leader/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("This scorecard could not be read.")).not.toBeInTheDocument();
  });
});
