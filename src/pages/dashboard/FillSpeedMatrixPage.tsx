import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Gauge } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimeMotionMatrixCard } from "@/components/smartTarget/TimeMotionMatrixCard";
import { ItouchFillTimeAlert } from "@/components/smartTarget/ItouchFillTimeAlert";
import { SkuFillTimesCard } from "@/components/smartTarget/SkuFillTimesCard";
import { BatchFillStandardsCard } from "@/components/smartTarget/BatchFillStandardsCard";
import { FillTimeCorrectionCard } from "@/components/smartTarget/FillTimeCorrectionCard";
import SkuFillTimesAdminPage from "./SkuFillTimesAdminPage";
import LineFillPerformancePage from "./LineFillPerformancePage";

export default function FillSpeedMatrixPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader dense module="Production" title="Fill speed matrix" description="Standard fill time per line, machine and pack size, the real fill time per SKU and performance shift by shift." icon={<Gauge className="h-5 w-5" />} className="mb-0 border-b pb-3" />
        <Tabs defaultValue="matrix" className="space-y-6">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="matrix" className="h-12 px-4">Fill speed matrix</TabsTrigger>
            <TabsTrigger value="per-line" className="h-12 px-4">Fill time per line</TabsTrigger>
            <TabsTrigger value="performance" className="h-12 px-4">Line fill performance</TabsTrigger>
          </TabsList>
          <TabsContent value="matrix" className="space-y-6">
            <ItouchFillTimeAlert />
            <FillTimeCorrectionCard />
            <TimeMotionMatrixCard />
            <BatchFillStandardsCard />
            <SkuFillTimesCard />
          </TabsContent>
          <TabsContent value="per-line"><SkuFillTimesAdminPage embedded /></TabsContent>
          <TabsContent value="performance"><LineFillPerformancePage embedded /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
