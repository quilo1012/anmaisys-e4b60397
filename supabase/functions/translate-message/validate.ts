export const MAX_TEXT_LENGTH = 5000;
export const MODES = ["polish", "part_search"] as const;
export type Mode = (typeof MODES)[number] | undefined;

export type Validated =
  | { ok: true; text: string; mode: Mode }
  | { ok: false; status: 400; error: string };

/** Checks the request body; every problem is a 400 with a reason, never a 500. */
export function validateBody(body: unknown): Validated {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Request body must be a JSON object with a 'text' field" };
  }
  const { text, mode } = body as { text?: unknown; mode?: unknown };
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, status: 400, error: "text is required and must be a non-empty string" };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, status: 400, error: `text must be at most ${MAX_TEXT_LENGTH} characters` };
  }
  if (mode !== undefined && mode !== null && !(MODES as readonly unknown[]).includes(mode)) {
    return { ok: false, status: 400, error: `mode must be one of: ${MODES.join(", ")}` };
  }
  return { ok: true, text, mode: (mode ?? undefined) as Mode };
}

/** Message for the missing provider key: a configuration problem, reported as 503. */
export const MISSING_KEY_ERROR =
  "Translation is not configured: ANTHROPIC_API_KEY is not set in the project secrets";
