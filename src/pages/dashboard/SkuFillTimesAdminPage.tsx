import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListChecks } from "lucide-react";
import { SkuFillTimesCard } from "@/components/smartTarget/SkuFillTimesCard";

export default function SkuFillTimesAdminPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader dense module="Production" title="Approved SKU fill times" description="Review, edit and approve the standard fill time for every SKU." icon={<ListChecks className="h-5 w-5" />} className="mb-0 border-b pb-3" />
        <SkuFillTimesCard initialStatus="approved" tall />
      </div>
    </DashboardLayout>
  );
}
