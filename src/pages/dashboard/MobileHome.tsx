import { DashboardLayout, navItems } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { canForDevice } from "@/lib/permissions";
import { useDeviceType } from "@/hooks/use-device-type";
import { useSiteBanner, bannerUrlsForDevice } from "@/hooks/useSiteBanner";
import { SiteBannerImages } from "@/components/SiteBannerImages";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export default function MobileHome() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const device = useDeviceType();
  const { data: banner } = useSiteBanner();
  const heroUrls = bannerUrlsForDevice(banner, device);
  const effectiveRole = (role === "co_engineer" ? "engineer" : role) as AppRole | null;

  // Quick links respect what this role is allowed to see on THIS device.
  const items = navItems.filter(
    (i) => effectiveRole && i.roles.includes(effectiveRole) && (!i.action || canForDevice(effectiveRole, i.action, device)),
  );

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6 py-6">
        {/* Welcome hero — the live site banner carousel sits BEHIND the greeting.
            Rotates the site's two hero slides and uses the device-specific artwork. */}
        <div className="relative min-h-[220px] overflow-hidden rounded-2xl border shadow-sm sm:min-h-[300px]">
          {heroUrls.length > 0 ? (
            <>
              <SiteBannerImages urls={heroUrls} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/70" />
          )}
          <div className="relative z-10 flex min-h-[220px] flex-col items-center justify-center gap-1.5 px-6 py-12 text-center text-white sm:min-h-[300px] sm:py-16">
            <p className="text-base text-white/85">
              Hello, <span className="font-semibold text-white">{profile?.name || "there"}</span>
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Welcome to AN Production System</h1>
            <p className="text-sm text-white/75">Today is {today}</p>
            {heroUrls.length > 0 && (
              <a
                href={banner?.url ?? "https://appliednutrition.uk/"}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-xs font-medium text-white/80 underline underline-offset-2 hover:text-white"
              >
                appliednutrition.uk
              </a>
            )}
          </div>
        </div>

        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <Card
                  key={it.url}
                  onClick={() => navigate(it.url)}
                  className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40 active:scale-[0.99]"
                >
                  <CardContent className="flex flex-col items-center justify-center gap-2 p-5 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-sm font-medium leading-tight">{it.title}</span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
