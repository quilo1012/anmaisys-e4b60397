import { AnimatedWelcomeHeader } from "@/components/AnimatedWelcomeHeader";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";

/**
 * How every landing screen opens: the greeting, with today's date and shift.
 *
 * The Applied Nutrition hero banner used to sit here, desktop only. It is gone: on
 * the screen a supervisor opens twenty times a shift, the first fold is the most
 * valuable space in the system, and a promotion was holding it while the live status
 * — lines stopped, orders nobody has accepted, who is in today — sat below it.
 *
 * The banner itself still works. useSiteBanner, SiteBannerImages and the cron that
 * scrapes appliednutrition.uk are all in place, so putting it back on a screen where
 * it earns its space is a two-line change rather than a rebuild.
 *
 * One component rather than seven copies, so a change to the greeting cannot land on
 * the manager's screen and miss the engineer's.
 */
export function DashboardWelcome() {
  const { profile } = useAuth();
  const { shiftCode } = getCurrentFactoryShift();
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <AnimatedWelcomeHeader name={profile?.name || "there"} dateLabel={`${today} · ${SHIFT_LABEL[shiftCode]}`} />
  );
}

export default DashboardWelcome;
