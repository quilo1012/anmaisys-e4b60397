import { DashboardLayout } from "@/components/DashboardLayout";
import { Settings as SettingsIcon, Users, ShieldCheck, Plug, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";

const LINKS = [
  { title: "Users & roles", desc: "Create, approve and manage staff accounts and roles.", icon: Users, url: "/users/manage" },
  { title: "Permissions", desc: "Fine-tune what each role can see and do.", icon: ShieldCheck, url: "/dashboard/permissions" },
  { title: "iTouching Sync", desc: "Configure and monitor the iTouching i4 integration.", icon: Plug, url: "/dashboard/intouch-settings" },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <SettingsIcon className="h-6 w-6" />
            Settings
          </h2>
          <p className="text-muted-foreground">System configuration lives in its own dedicated screens — jump to one below.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map((l) => (
            <button key={l.url} type="button" onClick={() => navigate(l.url)} className="text-left">
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary"><l.icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-semibold">{l.title} <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></div>
                    <p className="text-sm text-muted-foreground">{l.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
