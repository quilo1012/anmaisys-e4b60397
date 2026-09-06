/**
 * A temporary shape-finder for the Actions endpoint. Statuses and bodies only —
 * never the token.
 */

export const CANDIDATES: {
  name: string;
  body: Record<string, unknown> | null;
  path?: string;
  method?: string;
}[] = [
  { name: "desc", body: { page_size: 1, sort_field: "MODIFIED_AT", sort_direction: "DESC" } },
  { name: "desc_long", body: { page_size: 1, sort_field: "MODIFIED_AT", sort_direction: "SORT_DIRECTION_DESC" } },
  { name: "desc_lower", body: { page_size: 1, sort_field: "MODIFIED_AT", sort_direction: "desc" } },
];
