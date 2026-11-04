# Smart AI Target: calculation engine v1.0

Status: implemented and unit-tested on synthetic data only, 02/11/2026. Not connected to
anything, not deployed, and not imported by any screen.

- Code: `src/lib/smartTargetEngine.ts`
- Tests: `src/lib/smartTargetEngine.test.ts` (44 tests)
- Earlier design, on hold: `docs/superpowers/specs/2026-10-25-smart-ai-target-design.md`

## What it does

`forecastShift(input, config)` takes one line and one shift and returns:

- the shift date and type
- each planned job, in iTouch sequence order
- expected containers for each job and for the shift
- expected containers per hour
- actual valid containers, the difference from the forecast, and observed speed
- the changeover, mixing and break assumptions it applied
- how many jobs it could forecast (coverage) and a confidence level
- warnings that explain every gap

`backtest(rows)` scores forecasts against actuals for completed shifts.

The engine does arithmetic only. It reads nothing, writes nothing, and makes no calls to
the clock, randomness, the network or the database. Test T16 checks this against the
source code.

## The logic

1. **Shift window.** DAY runs 06:00–18:00 and NIGHT runs 18:00–06:00 the next day, both
   Europe/London time. The gross length is the real elapsed time, which is 780 or 660
   minutes on the nights the clocks change. Those nights raise the warning `GROSS_NOT_720`.
2. **Blocked time** is breaks plus downtime, merged into a single set of intervals.
   Anything that overlaps is subtracted once.
   - If break times are supplied, they are placed on the timeline.
   - If they are not, each job carries a share of the 75-minute allowance in proportion
     to the length of its slot (a whole-shift job carries all 75), taken from its
     productive time. The share is never set against setup or downtime, because an
     overlap that cannot be placed cannot be credited. Confidence is capped at low.
3. **Transitions.** Jobs are taken in iTouch sequence order. SKUs are normalised first:
   upper case, with batch suffixes such as `-B7` removed.
   - Different SKU from the job before: changeover (default 25 min), then mixing.
   - Same SKU: neither.
   - For the first job of the shift, `previousSku` says what ran before. A SKU means
     compare as above. `null` means the line was empty, so mixing only. Not supplied
     means unknown: no changeover is charged, a warning is raised and confidence is low.
   - A job with no SKU, and the job straight after it, are `sku_unknown`: whether the
     product changed is not known, so neither changeover nor mixing is charged, and a
     warning is raised.
4. **Mixing** defaults to 30 min on Lines 1–4 and 40 min on Lines 5–6. A job can carry
   its own SKU-specific value.
   - Mixing follows the changeover and does not overlap it.
   - By default it also cannot overlap a break: it waits until the break ends. The
     setting `mixingMayOverlapBreak` allows the overlap.
5. **Job time.** Each job gets its time from one of two sources:
   - its planned window in the schedule
   - if there is no window: order quantity ÷ rate, labelled provisional
     (`DURATION_FROM_ORDER_QTY`). This only places the job. A job sized this way that
     finishes its order gets **no forecast**, because the number would just be the order
     quantity again. It gets one only if it is cut, at the end of the shift or at the
     next job's planned start, and then the forecast is rate × the time it actually has.
   - A window that is incomplete, unreadable or reversed is not used, and the warning
     `WINDOW_IGNORED` says so.

   If neither is available, the job gets no time and no forecast. Every later job without
   a window gets none either, because its start time is unknown. The engine never makes
   up a duration.
6. **Forecast** for each job = rate × productive minutes ÷ 60, where productive minutes
   are the job's time minus setup and blocked time. A shift total exists only when every
   job has a forecast. Otherwise the status is `partial` and only a subtotal of the known
   jobs is given.
7. **Rates** are taken per line and SKU, in containers per hour or per minute. Anything
   else is refused with a warning, including kg/hour, an unknown line or a zero rate.
   - A rate with fewer than 5 history shifts is not used, even if it is marked validated.
   - Validated and provisional rates are kept separate.
   - If two rates of the same status disagree, the result is `conflict` and no number is
     given.
8. **Filling events** count only when `eventSemantics.verified` is true. Until then the
   actual count is null and only candidate events are reported.
   - Events are set aside, in this order, for: no timestamp; another line; outside the
     shift; no event id (a repeat cannot be detected without one); a repeated id; a
     rejected status; an unknown status.
   - An event is tied to a job by its job id, otherwise by its time. A SKU that disagrees
     with the job makes it ambiguous.
9. **Observed speed** for a job = (n − 1) ÷ the minutes between its first and last valid
   container, minus breaks and downtime in between. It never uses Production Control
   start or finish times.
10. **Confidence.**
    - `medium`: every job uses a validated rate and a planned window, the break times are
      known, and the previous SKU is known.
    - `low`: any of those is missing.
    - `none`: there is no shift total.

    There is no `high` level until a backtest on real shifts has been approved.

## Test results (vitest 3.2.4, 02/11/2026)

`npx vitest run src/lib/smartTargetEngine.test.ts`: **51 passed, 0 failed** (44 below,
plus 6 regression tests R1–R6 from the review of 04/11 and one more case in T12).

The full unit suite (`npx vitest run`) passed 181 files and 3065 tests.
`npm run typecheck` and `eslint` on both files exited with 0.

All inputs are synthetic and dated 3 November 2026, when London time is the same as UTC.
"Rate 600" means 600 containers per hour.

| # | Input | Expected | Actual | Result |
|---|---|---|---|---|
| T01 | DAY 03/11 and DAY 15/07; events at 05:59:59, 06:00:00, 17:59:59 and 18:00:00 | 06:00–18:00 London (05:00Z in summer), 720 min; 2 events kept, 2 outside the shift | as expected | PASS |
| T02 | NIGHT 03/11; events at 23:59, 00:30 (next day), 06:00 (next day) and 17:59; NIGHT 24/10; date 30/02 | 18:00 to 06:00 the next day; 2 kept; 24/10 is 780 min with `GROSS_NOT_720`; 30/02 is `invalid_input` | as expected | PASS |
| T03 | One job for the whole shift, same SKU, rate 600; breaks of 15+30+30 positioned, then unknown | net 645; 6450 containers; confidence medium when positioned, low when unknown | as expected | PASS |
| T04 | 6 events: 2 valid, 1 repeated id, 1 rejected, 1 unknown status, 1 without id | valid 2, duplicate 1, rejected 1, ambiguous 2; unverified meaning gives actual null and 4 candidates | as expected | PASS |
| T05 | Job J1 06–12 (SKU A) and J2 12–18 (SKU B); events tied by job id, by time, with an SKU clash, with an unknown job, on another line | J1 1, J2 2, ambiguous 1, unassociated 1, wrong line 1, shift total 4 | as expected | PASS |
| T06 | Jobs A, A-B7, B in 4-hour windows | changeover 0/0/25 and mixing 0/0/30 min; productive 240/240/185 min; previous SKU B gives a change on job 1; unknown gives a warning and no changeover | as expected | PASS |
| T07 | Changeover from A to B, 720 min, mixing 30 | 20 min: 670 min, 6700 containers; 25: 665, 6650; 30: 660, 6600 | as expected | PASS |
| T08 | Line empty at start, Lines 1–6, then a job with 35 min mixing | mixing 30 on Lines 1–4, 40 on Lines 5–6; the job's own 35 when given | as expected | PASS |
| T09 | Break 06:00–06:30 and mixing 30 min at the start of the shift | overlap allowed: setup ends at minute 30, 690 min, 6900 containers; not allowed: minute 60, 660 min, 6600 | as expected | PASS |
| T10 | Downtime 10:00–11:00 entered twice, plus a break 10:30–11:15 | 75 min blocked, not 165; 645 productive | as expected | PASS |
| T11 | Events with a null or invalid timestamp; job 1 has a window, job 2 has neither window nor quantity, job 3 has a quantity only | 2 incomplete; jobs 2 and 3 not allocated, each with a reason; status `partial`, total null, subtotal 3600, coverage 1/3, confidence none | as expected | PASS |
| T12 | Order 1000, window 1 hour, rate 600, 450 verified events every 8 s; then order 300 with no window | forecast 600, actual 450, difference −150, observed 450/h; the order is reported but never used as the actual; the order-sized slot is 0–30 min and gets no forecast of its own; an order of 9000 cut at shift end forecasts 7200 | as expected | PASS |
| T13 | A validated rate with 3 history shifts; a provisional rate with 8; two validated rates (600 and 650) | insufficient history, no number; provisional gives 7200 with low confidence; the disagreeing pair is a conflict with no number | as expected | PASS |
| T14 | Line spellings; a rate in kg/hour; a rate on Line 7; a rate of 10 per minute; input line "Line 9" | refusals with `RATE_BAD_UNIT` and `RATE_BAD_LINE`; per-minute converted to 600/h; Line 9 is `invalid_input` | as expected | PASS |
| T15 | The same input twice, then with jobs and events in reverse order | identical output every time; the input is not changed | as expected | PASS |
| T16 | The engine's source code | only import is `./shifts`, which has no imports; no Supabase, fetch, insert/update/delete/rpc, `Date.now`, `new Date()`, `Math.random` or browser storage | as expected | PASS |
| T17 | Backtest on 6 rows (1 excluded, 1 without a forecast, 1 with actual 0); then 5 rows with one outlier | sufficient history: 3 of 4 scored, mean absolute error 26.7, median 20, median % error 10.1 (actual 0 left out of %); outlier at +100% flagged and kept | as expected | PASS |

Mutation check: four deliberate breakages were each caught by at least one test, and the
code was then restored. The breakages were double-counting overlaps, skipping duplicate
removal, charging a changeover on a repeated SKU, and counting events whose meaning was
unverified.

## Data sources used

None. No database, iTouch, SharePoint or any other system was queried. All inputs are
synthetic fixtures.

## What is missing before this can run on real shifts

| Input | Status | What is needed |
|---|---|---|
| Individual filler-scale events | **Not seen.** The repo's iTouch code reads only aggregate counts (`GoodParts`, `PartsMade[]` per period) and tries about 20 candidate endpoints, so no per-fill endpoint is known. | The endpoint name, a sample response, the field holding a unique event id, the timestamp field and its time zone, the accepted and rejected status values, and confirmation that one event equals one completed container. |
| iTouch job sequence | Partly available: `/api/appapi/getscheduledjobs` and the Work To List CSV give order, SKU and quantity. Whether the planned start and end times are reliable is not known. | A sample with times, to confirm they can serve as job windows. |
| Line/SKU rates | **None suitable.** `sku_products.target_per_hour` holds 0 for 208 SKUs and line-class defaults for the rest. `sku_production_history.units_per_hour` gives every SKU the whole shift. | A rate history built from verified events (blocked by the first row of this table), or rates approved by Production and labelled provisional. |
| Break times | Not recorded anywhere. Only the 75-minute allowance exists. | Fixed break times per shift, or confirmation that they vary, in which case the even spread stays. |
| Previous SKU at shift start | Not passed today. | The last job of the previous shift, from the same iTouch schedule. |
| Downtime intervals | `production_downtimes` has no rows since 29/07. Stops reach the database through the iTouch status log. | Agreement on which stop codes count as known downtime for forecasting. |
| Historical backtest | Not run: no authorised read of production in this session. The 29/10 analysis found 431 of 904 RAG plans written after the shift. | Authorisation for read-only counts, and actuals from verified events, not the RAG plan. |

## Decisions for Production (none of these is assumed final)

1. Is mixing charged at each new SKU only (the current default), or before every job?
2. Can the blender mix during a break? The default is no.
3. Changeover: 25 min for every SKU change, or a value per SKU pair?
4. Should a changeover be charged when what ran before the shift is unknown? The default is no, with a warning.
5. Minimum history before a rate is used: 5 shifts (taken from the earlier design).
6. Acceptable backtest error: not set. Production decides.
7. On nights when the clocks change (780 or 660 min), should the target follow the real
   time, as it does now?

## Review of 04/11/2026: defects found and fixed

An independent review of the engine, the input builder and the page found six defects
that the 44 tests did not catch. Each one now has its own test.

| # | Defect | Fix | Test |
|---|---|---|---|
| R1 | With no break times, setup and downtime absorbed part of the 75-minute break (one whole-shift job with a SKU change gave 5957 instead of 5900) | Each job carries its break share by slot length, taken after setup and downtime | R1 (×2) |
| R2 | A job sized from its order quantity always "forecast" exactly that quantity | No forecast unless the job is cut short | T12 |
| R3 | An order-sized job could run over the next job's planned window | It stops at the next planned start (`ORDER_RUNS_INTO_NEXT_JOB`), and an unusable window is reported (`WINDOW_IGNORED`) | R3 (×2) |
| R4 | A job with no SKU counted as a SKU change, and the job after it as "same SKU" | New transition `sku_unknown`, with nothing charged | R4 |
| R5 | Two sessions on one line had their jobs interleaved | Sessions are ordered by start, then jobs within each | input test |
| R6 | A non-numeric sequence or the browser's locale could change the job order | Code-point ordering, and the job goes last with `BAD_SEQUENCE` | R6 |

The page also hid every per-job warning and the confidence level. Both are shown now.
