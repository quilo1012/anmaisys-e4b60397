---
name: showing-missing-numbers-as-missing
description: Use when a production rate, shift target, standard or count is missing, zero, null or shows "—" on a screen, report or export, and someone asks for a number to be shown anyway ("fill it in", "show something sensible", "we can refine later"). Also in Portuguese - alvo em falta, taxa em falta, meta do turno vazia, preencher o alvo, mostrar um número.
---

# Showing missing numbers as missing

## Overview

In this factory a rate, target or count that was never recorded is shown as missing, together with who can record it. It is never shown as a stand-in number. A labelled stand-in is still a stand-in, because people quote the number and drop the label.

**Violating the letter of this rule is violating its spirit.** "≈720" is a number on the screen.

## What to deliver instead

When a value is missing, the deliverable has four parts:

1. **The cell stays "—"**, or `null` in data, exports and API responses. No change.
2. **The exact list of what is missing**: line, SKU and shift for each gap, plus the count.
3. **Who can enter the real value, and where**: the screen or table name.
4. **Optionally, make the gap easier to see**: a "missing rate" filter, a count badge or a sort. Never a value.

That is the whole answer, including under time pressure. In 10 minutes, the list is what a manager can actually use in front of a director.

**Stand-ins are all forbidden**, whatever the label:
- the line or class default
- the most common rate on the line
- the average or median of other SKUs
- a similar SKU's value
- last week's or last shift's value
- the order quantity
- the RAG plan
- a "conservative" lower value
- 0

## Rationalizations (all observed in testing)

| Excuse | Reality |
|---|---|
| "It is marked ≈ / grey / with a tooltip, so it's clear it isn't the SKU's rate" | The director reads 720, not the tooltip. Screenshots and exports drop the styling. |
| "It doesn't change any score or colour" | It changes what people say in the meeting. That is why it was asked for. |
| "The real fix is filling the rates; this is temporary" | A temporary number takes away the reason to do the real fix. |
| "I picked the lower value to be conservative" | Choosing which made-up number to show is still making one up. |
| "The manager asked for a sensible number, under time pressure" | Give the manager the missing list. It is faster to act on than a guess. |

## Red flags: stop, keep the "—", build the list

- A fallback that turns null into a number in display or export code: `?? lineDefault`, `?? avg`, `|| 0`.
- Adding "≈", "est.", italics or a tooltip to justify showing a number.
- "We can refine later."

## Why this repo

- 208 active SKUs hold `target_per_hour = 0`, and the rest share five line-class defaults (`src/lib/skuStandardRate.ts`).
- The pace rule was removed from `src/lib/linePerformance.ts` because it rested on those defaults.
- An automatic writer set two lines' targets to zero on 08/08 (`supabase/functions/calculate-shift-targets/index.ts`).
