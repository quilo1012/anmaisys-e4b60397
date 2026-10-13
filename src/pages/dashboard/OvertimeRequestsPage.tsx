import { DashboardLayout } from "@/components/DashboardLayout";
import { BackButton } from "@/components/BackButton";
import { WorkforceTabs } from "@/components/workforce/WorkforceTabs";
import { OvertimeRequestsPanel } from "@/components/workforce/OvertimeRequestsPanel";

/**
 * Overtime, before it is worked.
 *
 * The other Workforce screens read what already happened — who clocked in, who was
 * off, what it cost. This one is the ask that comes first: the supervisor says how
 * many they need, the floor says yes or no, the supervisor picks, and afterwards says
 * who actually turned up. That last part is what feeds the number beside every name.
 *
 * The header lives in the panel, because its one action — a new ask — opens the
 * panel's dialog, and the panel knows which shift tab it was pressed from.
 */
export default function OvertimeRequestsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <BackButton />
        <WorkforceTabs />
        <OvertimeRequestsPanel />
      </div>
    </DashboardLayout>
  );
}
