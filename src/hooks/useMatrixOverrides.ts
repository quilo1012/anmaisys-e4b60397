import { supabase } from "@/integrations/supabase/client";
import type { FillTimeOverrides } from "@/lib/fillSpeedMatrixEditor";

// Table exists only after APLICAR-fill-speed-matrix.sql; not in generated types.
const db = supabase as unknown as { from: (t: string) => any };
const T = "fill_speed_matrix_overrides";

/** null = table not active in this database (keep browser-only saving). */
export async function loadSharedOverrides(): Promise<FillTimeOverrides | null> {
  const { data, error } = await db.from(T).select("matrix_key, seconds");
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw error;
  }
  return Object.fromEntries((data ?? []).map((r: { matrix_key: string; seconds: number }) => [r.matrix_key, Number(r.seconds)]));
}

/** Makes the shared table equal to `next`, given what it held before. */
export async function syncSharedOverrides(prev: FillTimeOverrides, next: FillTimeOverrides): Promise<void> {
  const upserts = Object.entries(next).filter(([k, v]) => prev[k] !== v).map(([matrix_key, seconds]) => ({ matrix_key, seconds, updated_at: new Date().toISOString() }));
  const removed = Object.keys(prev).filter((k) => !(k in next));
  if (upserts.length) {
    const { error } = await db.from(T).upsert(upserts, { onConflict: "matrix_key" });
    if (error) throw error;
  }
  if (removed.length) {
    const { error } = await db.from(T).delete().in("matrix_key", removed);
    if (error) throw error;
  }
}
