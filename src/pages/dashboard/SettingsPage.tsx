import { DashboardLayout } from "@/components/DashboardLayout";
import { TeamsSetupCard } from "@/components/TeamsSetupCard";
import { WeeklyReportCard } from "@/components/WeeklyReportCard";
import { ShiftReportCard } from "@/components/ShiftReportCard";
import { ExcelExportCard } from "@/components/ExcelExportCard";
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
          <p className="text-muted-foreground">Integrations and scheduled reports.</p>
        </div>

        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Integrations</h3>
          <TeamsSetupCard />
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Reports</h3>
          <ShiftReportCard />
          <WeeklyReportCard />
          <ExcelExportCard />
        </section>
      </div>
    </DashboardLayout>
  );
}
