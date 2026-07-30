import { ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardWelcome } from "@/components/DashboardWelcome";
import { PageHeader } from "@/components/ui/PageHeader";
import { QualityActionsView } from "./QualityActionsPage";

export default function QualityPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        {/* Landing screen for the quality supervisor — same opening. */}
        <DashboardWelcome />

        {/* The system's page header, like every other screen — the page had a bare
            icon and title with no description. */}
        <PageHeader
          title="Quality"
          description="Log quality actions, track them to completion, and score them by severity."
          icon={<ShieldCheck className="h-5 w-5" />}
        />

        <QualityActionsView />
      </div>
    </DashboardLayout>
  );
}
