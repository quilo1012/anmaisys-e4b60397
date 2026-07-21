import { DashboardLayout } from "@/components/DashboardLayout";
import { Settings as SettingsIcon } from "lucide-react";

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <SettingsIcon className="h-6 w-6" />
            Settings
          </h2>
          <p className="text-muted-foreground">No settings available right now.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}
