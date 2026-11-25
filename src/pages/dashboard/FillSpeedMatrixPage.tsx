import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Gauge } from "lucide-react";
import { TimeMotionMatrixCard } from "@/components/smartTarget/TimeMotionMatrixCard";
import { FillTimeCorrectionCard } from "@/components/smartTarget/FillTimeCorrectionCard";

export default function FillSpeedMatrixPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader dense module="Production" title="Fill speed matrix" description="Standard fill time per line, machine and pack size. Reference only — targets are not changed here." icon={<Gauge className="h-5 w-5" />} className="mb-0 border-b pb-3" />
        <FillTimeCorrectionCard />
        <TimeMotionMatrixCard />
      </div>
    </DashboardLayout>
  );
}
