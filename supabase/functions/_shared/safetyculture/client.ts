/**
 * The SafetyCulture side of the integration: authentication, paging, retries, and
 * the shape-tolerant reading of an Action.
 *
 * The token is read from the environment inside this module and never returned,
 * logged or echoed. Callers get data or an error, never the credential.
 */

import type { ScAction } from "./normalize.ts";
import { parseAction } from "./parseAction.ts";

export { parseAction };

const BASE = "https://api.safetyculture.io";

export class ScAuthError extends Error {}
export class ScRateLimit extends Error {
  constructor(public retryAfterMs: number) {
    super("SafetyCulture rate limit");
  }
}
export class ScApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export class ScTimeout extends Error {}

function token(): string {
  const t = (Deno.env.get("SAFETYCULTURE_API_TOKEN") ?? "")
    .trim()
    .replace(/^SAFETYCULTURE_API_TOKEN\s*=\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!t) throw new ScAuthError("SAFETYCULTURE_API_TOKEN is not configured");
  return t;
}

export function orgId(): string {
  return (Deno.env.get("SAFETYCULTURE_ORGANIZATION_ID") ?? "").trim();
}

export function hasToken(): boolean {
  return !!(Deno.env.get("SAFETYCULTURE_API_TOKEN") ?? "").trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One HTTP call, with a timeout, one rate-limit wait and one retry on 5xx. */
async function call(
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") {
      if (attempt < 1) {
        await sleep(1_500);
        return call(path, init, attempt + 1);
      }
      throw new ScTimeout("SafetyCulture did not answer in time");
    }
    throw e;
  }

  if (res.status === 401 || res.status === 403) {
    throw new ScAuthError(`SafetyCulture rejected the credentials (${res.status})`);
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get("Retry-After") ?? 5) * 1000;
    if (attempt < 2) {
      await sleep(Math.min(wait || 5_000, 30_000));
      return call(path, init, attempt + 1);
    }
    throw new ScRateLimit(wait || 5_000);
  }
  if (res.status >= 500 && attempt < 1) {
    await sleep(2_000);
    return call(path, init, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ScApiError(res.status, `SafetyCulture replied ${res.status}: ${body.slice(0, 300)}`);
  }
  return await res.json();
}

function itemsOf(payload: unknown): Record<string, unknown>[] {
  const p = (payload ?? {}) as Record<string, unknown>;
  for (const key of ["actions", "items", "tasks", "data", "results"]) {
    const v = p[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [];
}

function nextToken(payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  return (
    (typeof p.next_page_token === "string" && p.next_page_token) ||
    (typeof p.nextPageToken === "string" && p.nextPageToken) ||
    null
  );
}

/** Authentication probe for the admin screen. Returns nothing secret. */
export async function testConnection(): Promise<{ ok: true; actions_visible: number }> {
  const payload = await call("/tasks/v1/actions/list", {
    method: "POST",
    body: JSON.stringify({ page_size: 1 }),
  });
  return { ok: true, actions_visible: itemsOf(payload).length };
}

/**
 * Every Action modified since `modifiedAfter`, oldest first, following the page
 * token until SafetyCulture stops handing one out.
 */
export async function listActions(
  modifiedAfter: string | null,
  maxPages = 5,
): Promise<ScAction[]> {
  const out: ScAction[] = [];
  let token: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res = await listActionsPage(token);
    for (const a of res.actions) {
      if (modifiedAfter && a.modified_at && a.modified_at <= modifiedAfter) continue;
      out.push(a);
    }
    token = res.nextToken;
    if (!token) break;
  }
  return out;
}

/**
 * One page of Actions plus the token for the next.
 *
 * The endpoint offers no "modified since" filter and ignores the sort hint, so
 * the sweep has to walk the whole list — 6,000+ Actions here. Handing back a page
 * at a time lets the caller write each one and drop it, instead of holding the
 * entire organisation in memory and running the worker out of resources.
 */
export async function listActionsPage(
  pageToken: string | null,
): Promise<{ actions: ScAction[]; nextToken: string | null; total: number | null }> {
  const body: Record<string, unknown> = { page_size: 100 };
  if (pageToken) body.page_token = pageToken;

  const payload = await call("/tasks/v1/actions/list", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const rows = itemsOf(payload);
  const actions: ScAction[] = [];
  for (const r of rows) {
    const a = parseAction(r);
    if (a) actions.push(a);
  }
  const total = Number((payload as Record<string, unknown>)?.total ?? NaN);
  return {
    actions,
    nextToken: rows.length ? nextToken(payload) : null,
    total: Number.isFinite(total) ? total : null,
  };
}

/** A single Action, for the webhook path where only the id arrives. */
export async function getAction(id: string): Promise<ScAction | null> {
  const payload = (await call(`/tasks/v1/actions/${encodeURIComponent(id)}`)) as Record<
    string,
    unknown
  >;
  const raw = (payload.action ?? payload.task ?? payload) as Record<string, unknown>;
  return parseAction(raw);
}
