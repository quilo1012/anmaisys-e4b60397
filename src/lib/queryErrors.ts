import { toast } from "sonner";

/**
 * Turn a failed request into something a person can act on.
 *
 * Silence was the old behaviour: a denied query left React Query in an error state
 * that most screens do not render, so a policy refusing the request, a tablet losing
 * its connection, and a table with no rows all looked the same — an empty screen.
 */
export function describeError(error: unknown): { title: string; description?: string } | null {
  const err = error as { message?: string; code?: string; status?: number; statusCode?: number } | null;
  const message = err?.message ?? "";
  const status = err?.status ?? err?.statusCode;
  const code = err?.code;

  // A RAISE EXCEPTION from one of our own triggers: "Attach the evidence before
  // validating this action". That is a rule, not a fault, and the dialog that made
  // the request already says so in its own words.
  if (code === "P0001") return null;
  // .single() with no rows — expected in plenty of places.
  if (code === "PGRST116") return null;

  if (status === 401 || status === 403 || code === "42501" || /row-level security|permission denied/i.test(message)) {
    return {
      title: "You do not have access to this",
      description: "The system refused the request rather than showing you an empty screen. Ask an admin if you need it.",
    };
  }
  if (/failed to fetch|networkerror|offline/i.test(message)) {
    return { title: "No connection to the server", description: "The screen may be showing what it loaded earlier." };
  }
  return { title: "Something did not load", description: message || undefined };
}

/** Same message twice in a few seconds is one broken screen, not two problems. */
const recent = new Map<string, number>();

export function reportQueryError(error: unknown, now: number = Date.now()): boolean {
  const described = describeError(error);
  if (!described) return false;
  const key = `${described.title}|${described.description ?? ""}`;
  // has(), not `?? 0`: defaulting an unseen key to 0 made the very first failure look
  // like a repeat whenever `now` was small, and swallowed it.
  const last = recent.get(key);
  if (last !== undefined && now - last < 8000) return false;
  recent.set(key, now);
  toast.error(described.title, { description: described.description });
  return true;
}

/** Test seam: the dedupe window is module state. */
export function resetErrorDedupe() {
  recent.clear();
}
