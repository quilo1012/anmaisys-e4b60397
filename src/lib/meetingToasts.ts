import { toast } from "sonner";

/** The toast after an answer; says so when the reason could not be kept (before BLOCO 161). */
export function answeredToast(response: "accepted" | "declined", r: { reasonDropped: boolean }) {
  if (response === "accepted") toast.success("Accepted");
  else if (r.reasonDropped) toast.success("Declined", { description: "The reason could not be saved yet; the organiser sees only that you declined." });
  else toast.success("Declined");
}
