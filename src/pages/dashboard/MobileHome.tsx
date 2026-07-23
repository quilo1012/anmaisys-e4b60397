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
      <div className="mx-auto max-w-5xl space-y-8 py-8">
        {/* Welcome header — its own section, never overlapping the banner. */}
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Hello, <span className="font-semibold text-foreground">{profile?.name || "there"}</span>
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Welcome to AN Production System</h1>
          <p className="text-sm text-muted-foreground">
            Production Management Platform<span className="mx-1.5 text-muted-foreground/50">·</span>{today}
          </p>
        </header>

        {/* Banner — a clean branding element (site carousel), no text on top. */}
        {heroUrls.length > 0 && (
          <a
            href={banner?.url ?? "https://appliednutrition.uk/"}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block aspect-[16/6] overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md sm:aspect-[16/5]"
            aria-label="Applied Nutrition"
          >
            <SiteBannerImages urls={heroUrls} />
          </a>
        )}

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
