import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { summariseHeadcountDay, type HeadcountDayShift } from "@/lib/ragHeadcount";

export type RagHeadcountShift = "day" | "night";

export interface RagWeekHeadcount {
  /** `${yyyy-MM-dd}|day|night` → that day and shift, or absent when the sheet has none. */
  byKey: Map<string, HeadcountDayShift>;
  /** Days the reader could not answer for, so the block can say so instead of showing zeros. */
  missing: { date: string; shift: RagHeadcountShift; reason: string }[];
}

/**
 * The week's headcount, from the SharePoint reader, on demand.
 *
 * Fetched only when the block is opened — the reader sleeps between uses and a first
 * call can take a minute, which is not something to spend on every board load. The
 * health call goes first to wake it, and the fourteen day/shift reads then run
 * together; a day the sheet does not cover is reported, never filled with zeros.
 */
export function useRagWeekHeadcount(dates: string[], enabled: boolean) {
  return useQuery<RagWeekHeadcount>({
    queryKey: ["rag-week-headcount", dates],
    enabled: enabled && dates.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      // Wake the reader once. A failure here is not fatal: the day reads below report
      // their own reason, which is what the block shows.
      await supabase.functions.invoke("headcount-sharepoint", { body: { mode: "health" } }).catch(() => null);

      const jobs: { date: string; shift: RagHeadcountShift }[] = [];
      for (const date of dates) for (const shift of ["day", "night"] as RagHeadcountShift[]) jobs.push({ date, shift });

      const results = await Promise.allSettled(
        jobs.map(async (job) => {
          const { data, error } = await supabase.functions.invoke("headcount-sharepoint", {
            body: { mode: "date", date: job.date, shift: job.shift },
          });
          if (error) throw new Error(error.message);
          return { job, data: data as any };
        }),
      );

      const byKey = new Map<string, HeadcountDayShift>();
      const missing: RagWeekHeadcount["missing"] = [];

      results.forEach((r, i) => {
        const job = jobs[i];
        if (r.status === "rejected") {
          missing.push({ ...job, reason: String((r.reason as Error)?.message ?? r.reason) });
          return;
        }
        const payload = r.value.data;
        if (!payload?.ok || !payload?.headcount) {
          missing.push({ ...job, reason: String(payload?.message ?? payload?.error ?? "no answer") });
          return;
        }
        byKey.set(`${job.date}|${job.shift}`, summariseHeadcountDay(payload.headcount));
      });

      return { byKey, missing };
    },
  });
}
