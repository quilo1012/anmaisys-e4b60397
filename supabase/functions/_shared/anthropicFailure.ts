/**
 * What a refused Anthropic call becomes on the way back to the app.
 *
 * WHY THIS EXISTS. On 15/11/2026 from 07:05 the Anthropic account ran out of credits.
 * Anthropic does not answer that with 401 or 402: it answers **400
 * `invalid_request_error`**, with the reason only in the sentence — "Your credit balance
 * is too low to access the Anthropic API." The three AI functions knew 429 and 401/403,
 * so the empty account fell through to `AI error: <raw body>` with a **502**, and Root
 * Diagnostics filed it as a gateway fault, six times in 85 minutes, beside two real
 * database stalls. Nothing in it said "pay the bill", which is the only thing that fixes
 * it, and a 502 also counts as a backend stall in `backendHealth.isDegradedError`.
 *
 * WHAT IT ANSWERS. An empty account is **402** with `code: "ai_credits_exhausted"`:
 *  - 4xx, so the client never retries it (`isClientError`) and it never pushes the app
 *    into degraded mode — the database is not what is wrong;
 *  - 402 is the status the old Lovable gateway branch used for the same situation
 *    (`if (resp.status === 402) return "AI credits exhausted"`), so it reads the same;
 *  - the sentence names the fix and where to do it, because that sentence is what Root
 *    Diagnostics shows the admin.
 *
 * The screens already fall back when translation fails (the engineer's own words are
 * saved and he is told), so nothing is lost; what changes is that the admin is told why.
 *
 * Pure, no Deno globals: the vitest suite imports it directly.
 */

export type AiFailureCode =
  | "ai_credits_exhausted"
  | "ai_key_rejected"
  | "ai_rate_limited"
  | "ai_error";

export interface AiFailure {
  status: number;
  code: AiFailureCode;
  error: string;
}

/**
 * Shared by three screens — translation, part photo search, SKU analysis — and shown
 * verbatim by the part search (`useIdentifyPart` reads `body.error`), so it names no
 * one feature and tells whoever reads it who can fix it.
 */
export const CREDITS_EXHAUSTED_ERROR =
  "AI unavailable: the Anthropic account has run out of credits. An admin must add credits at console.anthropic.com → Plans & Billing.";

/** The provider's own error type and sentence, when the body is the usual JSON. */
function providerError(bodyText: string): { type: string; message: string } {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { type?: unknown; message?: unknown } };
    return {
      type: typeof parsed?.error?.type === "string" ? parsed.error.type : "",
      message: typeof parsed?.error?.message === "string" ? parsed.error.message : "",
    };
  } catch {
    return { type: "", message: "" };
  }
}

/**
 * An empty account, in each shape it has been seen or is documented in: the 400 with
 * the credit sentence (seen 15/11), and `billing_error` / 402.
 */
export function isCreditsExhausted(status: number, bodyText: string): boolean {
  if (status === 402) return true;
  const { type, message } = providerError(bodyText);
  if (type === "billing_error") return true;
  return /credit balance is too low/i.test(message || bodyText);
}

/**
 * The answer for a non-OK Anthropic response. `messages` lets each function keep the
 * wording its screen already shows for the rate limit and the rejected key.
 */
export function anthropicFailure(
  status: number,
  bodyText: string,
  messages: { rateLimited: string; keyRejected: string },
): AiFailure {
  if (isCreditsExhausted(status, bodyText)) {
    return { status: 402, code: "ai_credits_exhausted", error: CREDITS_EXHAUSTED_ERROR };
  }
  if (status === 429) return { status: 429, code: "ai_rate_limited", error: messages.rateLimited };
  if (status === 401 || status === 403) {
    return { status: 502, code: "ai_key_rejected", error: messages.keyRejected };
  }
  return { status: 502, code: "ai_error", error: `AI error: ${bodyText.slice(0, 300)}` };
}
