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

/** Which tables should fail this test. Reset per case. */
const failing = new Set<string>();
/** Rows a table should hand back when it does not fail. Reset per case. */
const rows = new Map<string, unknown[]>();
/** When set, any select naming `domain` fails the way a pre-20260817090000 base does. */
const state = { noDomainColumn: false };

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
  };
  for (const m of ["eq", "in", "gte", "lte", "ilike", "order", "limit", "not", "or"]) {
    chain[m] = () => chain;
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

function draw() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LeaderScorecard leaderName="Ailton" from="2026-08-01" to="2026-08-17" />
    </QueryClientProvider>,
  );
}

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
