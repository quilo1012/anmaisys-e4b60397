import { AnimatedWelcomeHeader } from "@/components/AnimatedWelcomeHeader";
import { SiteBannerImages } from "@/components/SiteBannerImages";
import { useSiteBanner, bannerUrlsForDevice } from "@/hooks/useSiteBanner";
import { useDeviceType } from "@/hooks/use-device-type";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";

/**
 * How every landing screen opens: the greeting with today's date and shift, then the
 * Applied Nutrition banner.
 *
 * One component rather than four copies, so a change to the greeting or the banner
 * cannot land on the manager's screen and miss the engineer's.
 */
export function DashboardWelcome() {
  const { profile } = useAuth();
  const device = useDeviceType();
  const { data: banner } = useSiteBanner();
  const heroUrls = bannerUrlsForDevice(banner, device);
  const { shiftCode } = getCurrentFactoryShift();
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <>
      <AnimatedWelcomeHeader name={profile?.name || "there"} dateLabel={`${today} · ${SHIFT_LABEL[shiftCode]}`} />

      {heroUrls.length > 0 && (
        <a
          href={banner?.url ?? "https://appliednutrition.uk/"}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block aspect-[16/6] overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md sm:aspect-[16/5] print:hidden"
          aria-label="Applied Nutrition"
        >
          <SiteBannerImages urls={heroUrls} />
        </a>
      )}
    </>
  );
}

export default DashboardWelcome;
