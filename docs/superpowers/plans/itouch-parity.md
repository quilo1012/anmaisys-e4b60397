# Plan — every screen names the line the way iTouching does

## Context

The app mirrors a vendor system ("iTouching") that reports, per machine, a numeric
`Status` and a `DowntimeCode`. The single correct translation lives in
`classifyLive()` (`src/lib/lineLiveStatus.ts`), fed by the DB view
`v_line_live_status` through the shared hook `useLineLiveStatus`
(`src/hooks/useLineLiveStatus.ts`). Its vocabulary is the vendor's own: RUNNING /
STOPPED · NO CODE / a named PLANNED or UNPLANNED stop, shown verbatim
("No Planned Shift", "Line Preparation", "Deep Clean"), with iTouching's own colours
from `src/lib/intouchStopColours.ts` and the stop's H:MM:SS clock.

Settled legend for this installation: statuses 1, 2, 4, 6, 8 mean the machine is
running; 7 means stopped and always carries a code; 5 has never been observed.

Commit `ef9a5a48` fixed the Control Centre home panel, which had been reading work
orders instead of iTouching and painting ten lines green while six machines stood
still. An audit then found the same class of defect on three other surfaces. This
plan closes them.

## Global Constraints

- Never invent a state. If the board cannot read it, it says so — the existing
  `UNKNOWN_STATUS` / `NO_SIGNAL` / `NOT_MAPPED` states and their grey tone exist for
  exactly that and must not be replaced by a guess.
- The vendor's stop reason is displayed **verbatim and not uppercased**. It is the
  same string the operator reads on the iTouching screen; a second casing is a
  second name for the same thing.
- One source: read live state through `useLineLiveStatus()` + `classifyLive()`.
  Do not add a second query of `v_line_live_status` or of `intouch_machine_map`,
  and do not re-implement the status→state rule anywhere.
- A work order's claim ("an engineer was called out and nobody resumed the line")
  is a DIFFERENT fact from "the machine is not moving". Both may be shown; neither
  may silently stand in for the other.
- Colours come from `stopColour()` / `ITOUCH_RUNNING`, carried at low alpha for the
  background with the hue at full strength only in the dot, so both themes stay
  readable. Where the board cannot say, the tone stays grey.
- Every behaviour change needs a test. Pure logic goes in a `src/lib/*.ts` module
  with a `*.test.ts` beside it, in the style of `src/lib/lineStatusPanel.test.ts`
  (real observed readings as fixtures, comments saying what was seen and when).
- `npm run typecheck` and `npx vitest run` must both pass. `npx tsc --noEmit` at the
  repo root proves nothing here — it checks no files.
- Do not touch `src/integrations/supabase/types.ts` (regenerated externally).

## Task 1 — the factory-floor board reads iTouching

`src/pages/dashboard/ControlCenterPage.tsx` computes each line card's state
("Line Stopped" red / "Running" green) purely from `work_orders.line_stopped` and
`line_resumed_at` (see roughly lines 76-108, 315-329, 571). It never reads
iTouching. This is the same defect already fixed in `ControlCentreHome.tsx`: on
13/08 at 09:27 UTC it showed green for Capsules MC 1 and the GEL Line on
`No Planned Shift`, Capsules MC 2 on `Line Preparation`, and Filler Lines 1 and 6
on `Filling Blender/ Blending` — none of which had a work order, because none of
them is a breakdown. The GEL Line had been stopped since 17:06 the previous day.

Make this page take the line's state from iTouching, reusing what already exists:
`useLineLiveStatus()`, `classifyLive()`, and — where the shape fits —
`buildLineStatusRows()` from `src/lib/lineStatusPanel.ts`. Keep the work order's
own claim visible as its own separate mark, the way `ControlCentreHome.tsx` does
with its wrench icon; do not delete WO information, and do not let it decide the
line's state.

If the card needs logic beyond `buildLineStatusRows`, put that logic in a pure
function in `src/lib/` with tests beside it rather than inline in the page.

Verify: with the readings above, the six stopped machines show their vendor reason
and the four running lines show RUNNING.

## Task 2 — the admin machine-map badge stops calling running machines red

`src/pages/dashboard/IntouchMachineMapPage.tsx:216` renders the badge as
`status === 1 ? "default" : "destructive"`. Status 1 has never been observed on a
real line in this installation, while 2, 4, 6 and 8 all mean the machine is
running — so every running machine wears a red alarm-coloured badge. It also
ignores the stop code entirely, which is the thing that decides a stop.

Drive this badge from `classifyLive()` so it agrees with every other screen, and
show the state's own words. This is an admin diagnostic page: keep the raw status
number visible, because quoting it back to the vendor is what the page is for.

## Task 3 — the work-order banner stops sounding like the vendor's state

`src/components/LineStatusBanner.tsx` (used from `EngineerDashboard.tsx`) prints
"LINE RUNNING" / "LINE STOPPED" from `work_orders.line_stopped` and
`line_resumed_at` alone. Inside a work-order card that is the right fact, but the
wording reads as the current state of the line and can contradict iTouching — a
resumed order says "LINE RUNNING" while the line is stopped for an unrelated
reason.

Keep the source (this banner is about the order, not the machine) and change the
words so they say whose claim it is — e.g. the order's own wording about the line
having been stopped or resumed for this job. Do not add an iTouching read here:
the banner belongs to the order.

## Task 4 — the machine chips inside a zone card agree with the card

Task 1 made each zone card on `src/pages/dashboard/ControlCenterPage.tsx` take its
state from iTouching. The per-machine chips drawn INSIDE those cards
(`machineStatusMap`, around lines 356-370, rendered around line 693) were left as they
were: their colour comes from `work_orders` and predictive alerts. So a chip can read
green inside a card whose header reads `No Planned Shift` from the vendor — the same
disagreement this plan exists to eliminate, one level down and harder to spot.

Note the grain: `v_line_live_status` reports ONE machine per line (it is
`DISTINCT ON (line)`), and its `machine` column carries that machine's iTouching name
(e.g. "Filler Line 1", "Capsules MC 2"). The chips are per machine within a zone. So
for chips whose machine matches the live row's `machine`, show the vendor's state; for
machines iTouching says nothing about, the chip must NOT be painted as running — say
that the board cannot see it, in the grey that `NOT_MAPPED` / `NO_SIGNAL` already use.
Do not fabricate a state for a machine with no reading, and do not delete the work
order / predictive information — it keeps its own mark, as in Task 1.

If matching chips to live rows needs more than a lookup, put that logic in a pure
function in `src/lib/` with tests beside it.
