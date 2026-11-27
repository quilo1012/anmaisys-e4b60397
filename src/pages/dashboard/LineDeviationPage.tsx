import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Activity } from "lucide-react";
import { BatchReviewCard, ShiftStandardsCard } from "@/components/smartTarget/BatchReviewCards";

/** Per-line standard, real batch time, iTouch time and deviation — without opening the matrix. */
export default function LineDeviationPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader dense module="Production" title="Line deviation" description="Standard, real batch time and iTouch time per line, with the deviation shift by shift. Updates automatically every 15 minutes." icon={<Activity className="h-5 w-5" />} className="mb-0 border-b pb-3" />
        <ShiftStandardsCard title="Deviation per line" />
        <BatchReviewCard />
      </div>
    </DashboardLayout>
  );
}
