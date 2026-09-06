/**
 * The SafetyCulture side of the integration: authentication, paging, retries, and
 * the shape-tolerant reading of an Action.
 *
 * The token is read from the environment inside this module and never returned,
 * logged or echoed. Callers get data or an error, never the credential.
 */

import type { ScAction } from "./normalize.ts";

const BASE = "https://api.safetyculture.io";
const WEB = "https://app.safetyculture.com/tasks/actions";

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

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      (typeof o.label === "string" && o.label) ||
      (typeof o.name === "string" && o.name) ||
      (typeof o.key === "string" && o.key) ||
      (typeof o.value === "string" && o.value) ||
      null
    );
  }
  return String(v);
};

/**
 * SafetyCulture has changed the shape of an Action more than once and different
 * endpoints spell the same field differently. Read defensively: a missing field
 * becomes null, never an invented value.
 */
export function parseAction(raw: Record<string, unknown>): ScAction | null {
  const id =
    str(raw.unique_id) ?? str(raw.task_id) ?? str(raw.id) ?? str(raw.action_id);
  if (!id) return null;

  const assignees = Array.isArray(raw.assignees) ? raw.assignees : [];
  const labels = [
    ...(Array.isArray(raw.labels) ? raw.labels : []),
    ...(Array.isArray(raw.tags) ? raw.tags : []),
    ...(Array.isArray(raw.categories) ? raw.categories : []),
  ]
    .map((l) => str(l))
    .filter(Boolean) as string[];

  const custom: Record<string, string> = {};
  for (const f of (Array.isArray(raw.custom_fields) ? raw.custom_fields : []) as Record<
    string,
    unknown
  >[]) {
    const key = str(f.name) ?? str(f.key) ?? str(f.field_id);
    const val = str(f.value) ?? str(f.text) ?? str(f.display_value);
    if (key && val) custom[key] = val;
  }

  return {
    id,
    title: str(raw.title) ?? str(raw.name) ?? "",
    description: str(raw.description),
    status: str(raw.status),
    priority: str(raw.priority),
    created_at: str(raw.created_at) ?? str(raw.createdAt),
    modified_at: str(raw.modified_at) ?? str(raw.updated_at),
    due_at: str(raw.due_at) ?? str(raw.due_date),
    assignee: assignees.map((a) => str(a)).filter(Boolean).join(", ") || null,
    labels,
    site: str(raw.site) ?? str((raw.site_id as unknown) ?? null),
    asset: str(raw.asset),
    template: str(raw.template) ?? str(raw.template_id),
    custom_fields: custom,
    deleted: raw.deleted === true || str(raw.status) === "deleted",
    url: `${WEB}/${id}`,
  };
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
  maxPages = 20,
): Promise<ScAction[]> {
  const out: ScAction[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    // SafetyCulture validates these as protobuf enums, so the sort field is
    // spelled its way; the cursor is a plain timestamp filter.
    const body: Record<string, unknown> = {
      page_size: 100,
      sort_field: "SORT_FIELD_MODIFIED_AT",
      sort_direction: "SORT_DIRECTION_ASC",
    };
    if (modifiedAfter) body.modified_at_after = modifiedAfter;
    if (pageToken) body.page_token = pageToken;

    const payload = await call("/tasks/v1/actions/list", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const rows = itemsOf(payload);
    for (const r of rows) {
      const a = parseAction(r);
      if (a) out.push(a);
    }
    pageToken = nextToken(payload);
    if (!pageToken || rows.length === 0) break;
  }
  return out;
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

/**
 * Diagnostic: send an arbitrary list body and report what came back. Used only by
 * the admin "probe" mode while the accepted request shape is being pinned down.
 * Returns the status and a truncated body — never the credential.
 */
export async function rawList(
  body: Record<string, unknown> | null,
  path = "/tasks/v1/actions/list",
  method = "POST",
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: (await res.text()).slice(0, 4000) };
}
