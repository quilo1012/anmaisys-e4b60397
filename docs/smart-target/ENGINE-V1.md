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
     (`DURATION_FROM_ORDER_QTY`). A job sized this way that finishes its order at the
     line's rate forecasts **the order** (`ORDER_COMPLETES`, decided 05/11, Q23): the
     rate decided it fits, and the planner's question is what the plan delivers in the
     time there is. A job cut short, at the end of the shift or at the next planned
     start, forecasts rate × the time it actually has. Time left after the last job is
     reported as unplanned minutes, never turned into containers.
   - The **last** job with no order quantity runs to the end of the shift
     (`RUNS_TO_SHIFT_END`, decided 05/11, Q26): its forecast is the line's capacity for
     that product in the time left, labelled "No order quantity: runs to the end of the
     shift". An earlier job with no quantity has no end, so it and everything after it
     stay unknown.
   - Consecutive plan rows of the same SKU are one run, so they become one job. Its order
     is their sum only when every row has one.
   - A plan row with no quantity takes **what was left of iTouch's order** for the same
     SKU on that line when the queue was read (Q26b): order − made. The queue is read once
     per shift, by the first person to open the page while the shift runs, through the
     Planner's own `intouch-list-scheduled-jobs`, and kept in
     `smart_target_queue_snapshots` (BLOCO 147). The first read wins. A past or future
     shift is never read from iTouch, because the queue only describes now.
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
| iTouch job sequence | Available: order, SKU and quantity from the Work To List the planner imports. Its "Expected Start/End Time" columns are **not** used (decided 05/11): they are iTouch's own estimate, a fixed 90-minute setup per job plus order × ideal cycle, with no breaks, mixing or stops. Job time comes from order ÷ the line's rate instead. | Nothing. |
| Line/SKU rates | **Ideal cycles can be loaded (05/11).** `sku_products.target_per_hour` is still not used (0 for 208 SKUs, line-class defaults for the rest). iTouch's Product Details export gives a standard cycle per product and Filler Line; it is imported on the Smart Target page into `itouch_cycle_times` (BLOCO 146) and checked by `cleanCycles()`. On the 04/11 export: usable L1 1000, L2 961, L3 993, L4 394, L5 679, L6 1000; 2260 rows have no cycle, 38 on Line 4 are 0.31 s and 32 on Line 2 are 64.125 s, all listed for Production. | Each line's performance factor from shift history (`lineFactors()`), so ideal × factor becomes a provisional rate. Until then no rate is used. |
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
| R2 | A job sized from its order quantity always "forecast" exactly that quantity, with nothing saying so | Superseded by Q23 (05/11): it forecasts the order only when the rate says it completes, and the screen labels it "Order completes at this rate" | T12 |
| R3 | An order-sized job could run over the next job's planned window | It stops at the next planned start (`ORDER_RUNS_INTO_NEXT_JOB`), and an unusable window is reported (`WINDOW_IGNORED`) | R3 (×2) |
| R4 | A job with no SKU counted as a SKU change, and the job after it as "same SKU" | New transition `sku_unknown`, with nothing charged | R4 |
| R5 | Two sessions on one line had their jobs interleaved | Sessions are ordered by start, then jobs within each | input test |
| R6 | A non-numeric sequence or the browser's locale could change the job order | Code-point ordering, and the job goes last with `BAD_SEQUENCE` | R6 |

The page also hid every per-job warning and the confidence level. Both are shown now.

## Measuring the forecasts (05/11/2026, Q27a–Q30a)

- **Kept once per shift (BLOCO 148, `smart_target_forecasts`).** The first time the page has a complete forecast while a shift runs, it saves one row per planned line. "Complete" means rates known and the iTouch queue read, or known to be unavailable. The first save per line wins, so a forecast never changes after it is made.
- **Shadow lines.** Lines 1, 3 and 6 are saved too. They are forecast with their own factor and flagged `shown = false`, so there is evidence for switching them on.
- **What counts.** Only forecasts frozen in the **first two hours** of their shift are scored. Later ones are kept and listed as "made late".
- **The actual.** It is what operators logged for that line and shift, labelled provisional. It is read at view time and never stored with the forecast, so changing to iTouch filling events later re-scores the whole history.
- **The accuracy card.** Over the last four weeks it shows, per line: shifts measured, median absolute error, share within ±10% and ±20%, and what was not counted and why.

## The target before the shift starts (05/11/2026, Q31–Q40)

The operator must find the target when the shift begins. The page could only make one once someone opened it during the shift, from a plan (`production_items`) that only exists once the shift is opened.

- **Plan source (Q32a).** Before the shift, the plan is iTouch's queue for each line: the running job first, then iTouch's order, each with what is left to make (order − made). The line comes from iTouch, never from a second mapping (Q35a); a Trello → SKU/ASM → line sheet is a planning tool for the Job Import, kept separate.
- **Who makes it (Q33a, Q37a).** The edge function `smart-target-ahead`, called by pg_cron (BLOCO 149) at :30 and :50 of 04, 05, 16 and 17 UTC. Only the runs 20–40 and 0–20 minutes before a shift act, so the same schedule covers GMT and BST. The engine code is the page's own: it lives in `supabase/functions/_shared/smartTarget/`, and `src/lib/smartTarget*.ts` re-export it.
- **Lines with no jobs (Q36a).** The first run saves only lines with jobs. The last run also saves `no_itouch_jobs` for each line still without any, so late imports are counted instead of guessed. Nothing is saved when iTouch does not answer.
- **The job running when the queue is read (Q38a).** Its quantity is reduced by minutes-to-start × the line's rate for it, and the note says "estimated left at the start". If it would finish before the shift, it is dropped, and its SKU is still taken as what the line was last filling, so the next job pays the changeover.
- **On the tablet (Q34a, Q39a).** The new action `smarttarget.line_target` (operator by default) reads `smart_target_line_targets()`, which leaves the numbers out for lines still held back. The block sits in the same leader-PIN popover as the RAG target, because the tablet has always kept targets locked.
- **Frozen (Q40a).** The number never changes during the shift. When a product that was not in the plan is logged, the tablet says "Plan changed since HH:MM" next to it.
- **Measured the same way.** A target made before the shift counts as on time. `source` says whether it came from the server (`ahead`) or the page (`page`), and `queue_read_at` says when the queue it used was read.

## Every line with a number (05/11/2026, Q42–Q45)

Line 4 showed "No rate for PERUCRE500". iTouch holds 0.31 s for CRE500 and PERUCRE500 on Filler Line 4, below the 1.5 s floor (Q21). The decimal point is in the wrong place: Line 4 filled those products alone at 5.06 and 5.14 s a container, and dividing by its 62% factor gives about 3.1 s. CRE250's 2.1 s matches the same check. Those two products were 13% of Line 4's output over eight weeks.

- **Q42a. Correct it in iTouch.** Set 3.1 s, export Product Details again and load it in the iTouch cycles card. iTouch stays the only source of cycles.
- **Q43a. Observed rate as second choice.** Where iTouch has no usable cycle for a product on a line, the rate is the median of containers ÷ (net − setup) over the shifts in which that line filled only that product, with at least 3 such shifts. It is labelled "Rate observed on this line (N shifts)". iTouch × factor always comes first.
- **Q44a. Fix in iTouch.** A card lists only the products the lines actually filled in the eight weeks that have no usable cycle, biggest first, and whether an observed rate covers them meanwhile. Under it are the products typed in Production Control that are not in the product list; these count for no line's performance.
- **Q45a. Lines show themselves.** Until a line has 10 measured shifts, the starting choice stands: Lines 2, 4 and 5 shown, 1, 3 and 6 in shadow. From then on, each line is shown while its median miss is 15% or less, and goes back to shadow when it is not. The page, the pre-shift run and the tablet use the same rule (`lineVisibility`).

## The base of targets by line and product (06/11/2026)

`rateBase.ts` holds 801 rows, line × product, in containers per hour. Each is the geometric mean of up to three estimates: iTouch's cycle × the line factor, the Standard Line Targets reports by line, fill and container × the line ratio, and the line's logged shifts (923 shifts, 23/07 to 05/11). Market variants (PERU, KSA, NEU, BAG) share the shifts of their product on that line. `scripts/smart-target-base` rebuilds it.

Tested by building rates only from shifts before a cut-off and scoring the later shift totals, median miss:

| Built before | Today (iTouch × factor) | Base |
|---|---|---|
| 15/09 (486 shifts) | 17.0% | 13.7% |
| 01/10 (336 shifts) | 15.9% | 13.0% |
| 15/10 (205 shifts) | 15.8% | 14.2% |

Line 4 is the clearest gain (12–15% to 8–10%). Line 5 was not improved (15, 15 and 16% against 14, 12 and 17%), so it stays on iTouch × factor. Line 1 stays poor whichever rate is used (19–39%). The order is base, then iTouch × factor, then the rate observed on the line. The targets rest on operator-logged quantities and stay provisional.

## Finishing version 1 (06/11/2026, Q50–Q55)

- **Q50a.** The target before the shift goes live on the current database, without waiting for the AN Maintenance switch. At the switch, BLOCO 149 and both functions are applied there, with the cron URL changed.
- **Q51a.** The operator sees the Smart Target at the top of My Production, with no PIN. The RAG target stays behind the leader's PIN.
- **Q52a.** Lines 2, 4, 5 and 6 reach the tablet. Lines 1 and 3 show their number in the office, marked "Office only" with the reason. From 10 measured shifts on, the 15% rule decides.
- **Q53a. Version 1 is done when:** lines with jobs in iTouch have a target saved before each shift without anyone opening the page; the operator sees it; each shift is measured by itself; the page no longer reads "Diagnostic"; and lines on the tablet have a median miss of 15% or less over 10 real shifts. The 10% goal comes after that.
- **Q54a.** Version 2 holds the 48-hour horizon and batches. The Unleashed sheet with a Line column is analysed in Excel meanwhile. Batches need fill weights, and only 80 of 1,312 products have one.
- **Q55a.** The base is rebuilt every four weeks with `scripts/smart-target-base`, delivered as a PR with the before and after. Next: 04/12/2026.

- **Q56a (06/11).** A planned product with no rate anywhere takes the median of the line's rates, marked "Estimated". One tiny order used to leave every later job with no time and blank the line. A line with no rates at all still reads "—".
- **Q57a (06/11, BLOCO 150).** A forecast saved without a number can be replaced by one with a number. One with a number never changes. A replacement takes its own save time, so a late one counts as made late.

- **Q59b (06/11).** A SKU change on Line 5 costs 16 min in all, measured, in place of 25 + 40. Built from earlier shifts and scored on later ones, it missed by 10.8, 10.3 and 15.2% against 13.8, 12.0 and 16.6%. It is what shows in the totals, not a clocked time, so Production should confirm it. The other lines keep 25 + mixing: measuring them gave no clear gain, and Line 4 got worse. Line 6 is worth measuring again with more shifts.
- **Rows tie on when they were logged (06/11).** Operators' rows all have `display_order` 0, so the last job of a shift was chance. The pre-shift run now also reads the last product logged, for a queue with nothing running.

- **Every line on the tablet (06/11, replaces Q45a and Q52a).** Lines 1 and 3 read "No target yet" on the tablet, which looked broken. Every line now shows its number. A line over the 15% goal keeps it and shows a caution: on the tablet "A guide: this line usually misses by about N%", in the office "Wide margin" with the reason. Each shift's accuracy is still measured.

- **Not for operators yet (06/11, holds back Q51a).** The block on My Production is drawn only for `smarttarget.view`: the admin and the production office. Each shift's target is still made and measured. To give it to operators later, remove that one condition.

- **Why this target (06/11).** Each line card says how its number was reached, job by job. Fix in iTouch shows the SKU and product description, and the solution: the target per hour, the cycle to enter (that target ÷ the line's performance) and where it comes from.

- **The line's own shifts as a guard (06/11).** Line 1 was given 3,000 for Essential Protein 1.6 kg at night, when its last 8 shifts of that product made 1,432 to 1,988. Its factor is an average over everything it fills. Now, where a line has 3+ shifts of a product family (name up to the fill size, flavours together) and the rate is 1.3× or more from them, those shifts win. Scored on later shifts, this did no harm (17.0, 15.0 and 15.8% against 17.0, 15.9 and 15.8%): it stops the gross errors, and is not a better model. Why those shifts have 1h30 to 4h between runs is a question for Production.

## The rule since 06/11/2026 (Q62–Q64)

The first real day missed by +103, +422, +50, +3, −10 and +24% on Lines 1 to 6. Earlier tests here (13–16%) were flattered: they used each shift's real quantities, which a forecast cannot know. Treat those figures as measuring rates, not forecasts. The base of 801 rows, the observed rate and the family guard are gone.

- **A product's rate** is what the line did on its last 5 shifts mainly of that product family (name up to the fill size, flavours and markets together, shifts with samples left out), needing at least 2 in the eight weeks.
- **No history there:** iTouch × factor, marked "No history here: estimate". It was agreed as the line's average, but scored better (14.5% against 16.2%), so the line's usual rate is only the last resort.
- **Sample bags** (`BLENDED…`, or SAMPLE in the code or name): 185 min a batch, the median of 12 measured gaps, changeover and mixing included.
- **Estimates stay out of the main measurement:** a forecast with one is kept and counted, not scored.

Fair test, knowing only the shift's main product, on 464 shifts since 15/09 (`scripts/smart-target-base/fair-backtest.cjs`): 14.5% median miss against 17.1%; 12.1% on the 292 shifts with history. It says what the line usually does, not what it could do.

Replay of 06/11 day shift with this rule, from the iTouch queue read at 07:00 and only the shifts before that day (Lines 1 to 6): 1,500, 456, 1,580, 7,885, 2,667 and 3,800, against 1,432, 603, 1,777, 7,811, 2,769 and 4,044 logged (+5, −24, −11, +1, −4, −6%). The rule was chosen after seeing that day, so this shows it fixes those misses, not that it will hold: only the coming shifts can show that.

## What 06/11/2026 showed (analysis)

- **The page showed a recalculation as the target.** The big number was worked out on opening, from what operators had logged since, so it changed during the shift and knew the answer afterwards. The line card now leads with the target kept for the shift and its time, then what was logged and the miss, then "Calculated now" if it differs.
- **Each shift's kept target came from whichever code was live when it was saved.** That day alone held three methods. `ENGINE_VERSION` is now 2.0 and only the current method is scored; older rows are listed as "from an older method".
- **iTouch's queue reports nothing done.** Every row on both shifts read 0 done and "Scheduled"; finished batches just leave the list. So "order − made" subtracts nothing and the running-job correction (Q38) never fires.
- **What ran was not what was queued.** Line 5 was queued `BEEFXPCA` and logged `BEEFXP900CA`; Line 6 was queued `CWBAG450V` and logged `CW4V`, then `CW825V`; Line 4 queued `CRE500` and logged `PERUCRE500`. A forecast from the queue cannot see this.
- `BEEFXP900CA` is named "BEEF-XP CHERRY APPLE" in the product list, with no size, so it has no family and reads as no history.

- **Q65a (06/11).** The plan stays iTouch's queue, which the Production Office keeps up to date before the shift. A line card says "Plan changed" when a logged product is not in the kept plan; a market variant of a planned product (`PERUCRE500` for `CRE500`) does not count.

- **Shift strips (06/11, Q66a).** Each line is one row: a strip of the shift with blocks as wide as the time the forecast gives them, hatched for changeover and mixing, dashed for an estimate, and a line for now; then target, logged and miss, with the miss in red past 15%. The explanation opens from the row. No calculation changed.
