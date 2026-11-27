import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Gauge } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimeMotionMatrixCard } from "@/components/smartTarget/TimeMotionMatrixCard";
import { ItouchFillTimeAlert } from "@/components/smartTarget/ItouchFillTimeAlert";
import { SkuFillTimesCard } from "@/components/smartTarget/SkuFillTimesCard";
import { BatchFillStandardsCard } from "@/components/smartTarget/BatchFillStandardsCard";
import { FillTimeCorrectionCard } from "@/components/smartTarget/FillTimeCorrectionCard";
import { BatchReviewCard, ShiftStandardsCard } from "@/components/smartTarget/BatchReviewCards";
import SkuFillTimesAdminPage from "./SkuFillTimesAdminPage";
import LineFillPerformancePage from "./LineFillPerformancePage";
import ShiftHoursPage from "./ShiftHoursPage";

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
            <TabsTrigger value="line-batches" className="h-12 px-4">Line batch performance</TabsTrigger>
            <TabsTrigger value="batches" className="h-12 px-4">Batches per line</TabsTrigger>
            <TabsTrigger value="deviation" className="h-12 px-4">Line deviation</TabsTrigger>
            <TabsTrigger value="shift-hours" className="h-12 px-4">Shift hours</TabsTrigger>
          </TabsList>
          <TabsContent value="matrix" className="space-y-6">
            <ItouchFillTimeAlert />
            <FillTimeCorrectionCard />
            <TimeMotionMatrixCard />
            <ShiftStandardsCard />
            <BatchFillStandardsCard />
            <SkuFillTimesCard />
          </TabsContent>
          <TabsContent value="per-line"><SkuFillTimesAdminPage embedded /></TabsContent>
          <TabsContent value="performance"><LineFillPerformancePage embedded /></TabsContent>
          <TabsContent value="line-batches" className="space-y-6"><ShiftStandardsCard title="Line batch performance" /><BatchFillStandardsCard /></TabsContent>
          <TabsContent value="batches"><BatchReviewCard /></TabsContent>
          <TabsContent value="deviation" className="space-y-6"><ShiftStandardsCard title="Deviation per line" /><BatchReviewCard /></TabsContent>
          <TabsContent value="shift-hours"><ShiftHoursPage embedded /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
