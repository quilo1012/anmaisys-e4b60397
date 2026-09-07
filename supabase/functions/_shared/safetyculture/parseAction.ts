/**
 * Reading one SafetyCulture Action into the shape this system uses.
 *
 * Kept apart from `client.ts` because that file needs `Deno.env` for the token, and a
 * parser that cannot be run by the test suite is a parser nobody checks. Everything
 * here is pure: raw JSON in, `ScAction` out, no network and no environment.
 */

import type { ScAction } from "./normalize.ts";

const WEB = "https://app.safetyculture.com/tasks/actions";

/**
 * SafetyCulture answers with a priority UUID and no name for it — confirmed against
 * the published schema, where `priority_id` is "Priority ID of this task" and nothing
 * in the response carries a label. So a value that looks like an id is treated as one
 * and never shown to a person as though it were a name.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * One row of `/tasks/v1/actions/list`.
 *
 * The live API nests almost everything under `task` and answers with ids where a
 * reader wants names: `status` carries its own `key`, the assignee is whichever
 * collaborator holds the ASSIGNEE role, and the only human-readable clue about
 * which line an action came from is usually the inspection name ("B1/L6A").
 * Older/leaner shapes are still tolerated so a webhook payload parses too.
 */
export function parseAction(raw: Record<string, unknown>): ScAction | null {
  const t = ((raw.task as Record<string, unknown>) ?? raw) as Record<string, unknown>;

  const id = str(t.task_id) ?? str(t.id) ?? str(t.action_id) ?? str(raw.id);
  if (!id) return null;

  const collaborators = (Array.isArray(t.collaborators) ? t.collaborators : []) as Record<
    string,
    unknown
  >[];
  const assignees = collaborators
    .filter((c) => str(c.assigned_role) === "ASSIGNEE")
    .map((c) => {
      const u = (c.user ?? null) as Record<string, unknown> | null;
      if (u) return [str(u.firstname), str(u.lastname)].filter(Boolean).join(" ");
      const g = (c.group ?? null) as Record<string, unknown> | null;
      return g ? str(g.name) : null;
    })
    .filter(Boolean) as string[];
  const assignee = assignees.join(", ");

  const labels = [
    ...(Array.isArray(t.action_label) ? t.action_label : []),
    ...(Array.isArray(t.labels) ? t.labels : []),
  ]
    .map((l) => {
      const o = l as Record<string, unknown>;
      return str(o?.label_name) ?? str(l);
    })
    .filter(Boolean) as string[];

  const custom: Record<string, string> = {};
  for (const f of (Array.isArray(raw.custom_field_and_values) ? raw.custom_field_and_values : [])
    .concat(Array.isArray(t.custom_fields) ? (t.custom_fields as unknown[]) : []) as Record<
    string,
    unknown
  >[]) {
    const key = str(f.name) ?? str(f.key) ?? str(f.field_id);
    const val = str(f.value) ?? str(f.text) ?? str(f.display_value);
    if (key && val) custom[key] = val;
  }

  const inspection = (t.inspection ?? null) as Record<string, unknown> | null;
  const inspectionName = inspection ? str(inspection.inspection_name) : null;
  if (inspectionName) custom.inspection = inspectionName;
  const item = (t.inspection_item ?? null) as Record<string, unknown> | null;
  const itemName = item ? str(item.inspection_item_name) : null;
  if (itemName) custom.inspection_item = itemName;

  // `priority` may hold a readable name (the actions feed sends one) or the id
  // itself. Whichever it is, it is filed under the right heading.
  const rawPriority = str(t.priority);
  const priorityName = rawPriority && !UUID.test(rawPriority) ? rawPriority : null;
  const priorityId = str(t.priority_id) ?? (rawPriority && UUID.test(rawPriority) ? rawPriority : null);

  const status = (t.status ?? null) as Record<string, unknown> | null;
  const asset = (t.asset ?? null) as Record<string, unknown> | null;
  const site = (t.site ?? null) as Record<string, unknown> | null;
  const type = (raw.type ?? null) as Record<string, unknown> | null;

  return {
    id,
    title: str(t.title) ?? str(t.name) ?? "",
    description: str(t.description),
    status: (status ? str(status.key) ?? str(status.label) : null) ?? str(t.status),
    // The number the floor reads off the SafetyCulture screen. The API calls it
    // "the human readable unique ID of the task"; nothing here used to read it, so
    // the `#` column on the Quality screen was empty on all forty-nine rows.
    unique_id: str(t.unique_id) ?? str(t.action_number) ?? str(t.number),
    priority: priorityName,
    priority_id: priorityId,
    created_at: str(t.created_at),
    modified_at: str(t.modified_at) ?? str(t.updated_at),
    due_at: str(t.due_at) ?? str(t.due_date),
    assignee: assignee || null,
    assignees,
    labels,
    site: site ? str(site.name) : str(t.site),
    asset: asset ? str(asset.name) ?? str(asset.code) : null,
    template: str(t.template_name) ?? (type ? str(type.name) : null),
    custom_fields: custom,
    deleted: t.deleted === true,
    url: `${WEB}/${id}`,
  };
}
