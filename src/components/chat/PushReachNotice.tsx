import { BellOff } from "lucide-react";
import { usePushCoverage } from "@/hooks/usePushCoverage";

/**
 * Whether the person you are writing to will hear this on their phone.
 *
 * A direct message writes the bell and the bell asks `send-push`, which stops dead at
 * `if not exists (select 1 from push_subscriptions …) then return null`. That return is
 * silent: no error, no warning, nothing written. From the sending side it is
 * indistinguishable from delivery — so a supervisor writes "come to line 3" and waits
 * at line 3.
 *
 * On 22/10 that was 65 of the 70 active employees, and seven of the eight admins. The
 * message still arrives: it is in the Hub, and the bell lights up when they next open
 * the app. What it does not do is reach a phone in a pocket, and the person writing is
 * the one who needs to know that before they decide to rely on it.
 *
 * `push_coverage()` only answers for someone who can manage overtime, and returns rows
 * only for logins that HAVE a phone. So:
 *   - map is null    → the question could not be asked (no permission, or BLOCO 123 not
 *                      applied). Draw nothing. A missing answer must never be drawn as
 *                      "they have no phone", or it sends people chasing a non-problem.
 *   - id missing     → that login has no phone registered. This is the case worth saying.
 *   - id present     → at least one phone. Say nothing; silence is the good news.
 */
export function PushReachNotice({ recipientId, name }: { recipientId: string; name?: string }) {
  const { data: coverage } = usePushCoverage();
  if (!coverage) return null;
  if (coverage.get(recipientId)) return null;

  const who = name?.trim() || "This person";
  return (
    <p
      role="status"
      className="mx-3 mb-1 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.07] px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" aria-hidden="true" />
      <span>
        {who} has no phone set up for notifications, so this will not buzz. They will see
        it next time they open the app.
      </span>
    </p>
  );
}
