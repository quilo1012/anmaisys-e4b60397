import { differenceInMinutes } from "date-fns";
import { WO_TERMINAL_STATUSES } from "./woStatus";

export interface MachineWo {
  status: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  completed_at?: string | null;
}

/**
 * What a machine's order history says about it.
 *
 * The list of statuses that count as ended is WO_TERMINAL_STATUSES, and not one
 * written here. This page used to keep its own — completed, closed, finished — with
 * `force_closed` left out, and `force_closed` is how an order ends when nobody will
 * sign it off. Its downtime went uncounted, and since reliability is 100 minus
 * downtime over the period, leaving it out made the number go UP: the machine whose
 * orders keep having to be forced closed read as the most reliable in the factory.
 *
 * The repository had four different lists of "this order is over" when this was
 * written. Reading the shared one is the whole point.
 */
export function machineReliability(
  wos: MachineWo[],
  now: Date,
): { total: number; completed: number; totalDowntime: number; reliability: number } {
  const done = wos.filter((w) => (WO_TERMINAL_STATUSES as readonly string[]).includes(w.status));

  let totalDowntime = 0;
  for (const wo of done) {
    const ended = wo.finished_at || wo.completed_at;
    if (wo.started_at && ended) {
      totalDowntime += differenceInMinutes(new Date(ended), new Date(wo.started_at));
    }
  }

  // The period runs from the oldest order on record, which is the only start date
  // this page has. With no orders there is nothing to divide by and nothing known
  // against the machine, so it reads 100 rather than 0.
  const oldest = wos.reduce<MachineWo | null>(
    (acc, w) => (!acc || new Date(w.created_at) < new Date(acc.created_at) ? w : acc),
    null,
  );
  const totalPeriodMinutes = oldest ? differenceInMinutes(now, new Date(oldest.created_at)) : 1;
  const reliability = Math.max(0, Math.round(100 - (totalDowntime / Math.max(totalPeriodMinutes, 1)) * 100));

  return { total: wos.length, completed: done.length, totalDowntime, reliability };
}
