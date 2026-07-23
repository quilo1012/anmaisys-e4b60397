import { DashboardLayout, navItems } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { canMobile } from "@/lib/permissions";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export default function MobileHome() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const effectiveRole = (role === "co_engineer" ? "engineer" : role) as AppRole | null;

  const items = navItems.filter(
    (i) => effectiveRole && i.roles.includes(effectiveRole) && (!i.action || canMobile(effectiveRole, i.action)),
  );

  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-md space-y-6 py-8">
        <div className="space-y-1 text-center">
          <p className="text-base text-muted-foreground">
            Hello, <span className="font-semibold text-foreground">{profile?.name || "there"}</span>
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome to AN System</h1>
          <p className="text-sm text-muted-foreground">Today is {today}</p>
        </div>

        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
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
