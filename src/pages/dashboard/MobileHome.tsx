import { DashboardLayout, navItems } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { canForDevice } from "@/lib/permissions";
import { useDeviceType } from "@/hooks/use-device-type";
import { useSiteBanner } from "@/hooks/useSiteBanner";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export default function MobileHome() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const device = useDeviceType();
  const { data: banner } = useSiteBanner();
  const effectiveRole = (role === "co_engineer" ? "engineer" : role) as AppRole | null;

  // Quick links respect what this role is allowed to see on THIS device.
  const items = navItems.filter(
    (i) => effectiveRole && i.roles.includes(effectiveRole) && (!i.action || canForDevice(effectiveRole, i.action, device)),
  );

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6 py-6">
        {/* Welcome hero — the live site banner sits BEHIND the greeting on every login. */}
        <div className="relative overflow-hidden rounded-2xl border shadow-sm">
          {banner?.image ? (
            <>
              <img
                src={banner.image}
                alt={banner.title || "Applied Nutrition"}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/70" />
          )}
          <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 px-6 py-16 text-center text-white sm:py-20">
            <p className="text-base text-white/85">
              Hello, <span className="font-semibold text-white">{profile?.name || "there"}</span>
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Welcome to AN Production System</h1>
            <p className="text-sm text-white/75">Today is {today}</p>
            {banner?.image && (
              <a
                href={banner.url}
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
