import { DashboardLayout } from "@/components/DashboardLayout";
import { BackButton } from "@/components/BackButton";
import { WorkforceTabs } from "@/components/workforce/WorkforceTabs";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { OvertimeRequestsPanel } from "@/components/workforce/OvertimeRequestsPanel";

/**
 * Overtime, before it is worked.
 *
 * The other Workforce screens read what already happened — who clocked in, who was
 * off, what it cost. This one is the ask that comes first: the supervisor says how
 * many they need, the floor says yes or no, the supervisor picks, and afterwards says
 * who actually turned up. That last part is what feeds the number beside every name.
 */
export default function OvertimeRequestsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <BackButton />
        <WorkforceTabs />
        <ModuleHeader
          title="Overtime"
          description="Ask for people, see who says yes, pick — with each person's absences this month beside their name."
        />
        <OvertimeRequestsPanel />
      </div>
    </DashboardLayout>
  );
}
