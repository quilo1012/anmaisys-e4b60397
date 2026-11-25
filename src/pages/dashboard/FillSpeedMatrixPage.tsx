import { DashboardLayout } from "@/components/DashboardLayout";
import { TimeMotionMatrixCard } from "@/components/smartTarget/TimeMotionMatrixCard";
import { FillTimeCorrectionCard } from "@/components/smartTarget/FillTimeCorrectionCard";

export default function FillSpeedMatrixPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold">Fill speed matrix</h1>
          <p className="text-sm text-muted-foreground">Standard fill time per line, machine and pack size. Reference only — Smart Target targets are not changed here.</p>
        </div>
        <FillTimeCorrectionCard />
        <TimeMotionMatrixCard />
      </div>
    </DashboardLayout>
  );
}
