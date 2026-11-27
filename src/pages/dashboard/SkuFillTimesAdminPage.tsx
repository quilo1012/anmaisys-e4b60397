import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListChecks } from "lucide-react";
import { RegisterFillTimeCard } from "@/components/smartTarget/RegisterFillTimeCard";
import { SkuFillTimesCard } from "@/components/smartTarget/SkuFillTimesCard";

export default function SkuFillTimesAdminPage({ embedded = false }: { embedded?: boolean }) {
  const body = (
      <div className="space-y-6">
        {!embedded && <PageHeader dense module="Production" title="Fill time per line" description="Record the real fill time of each SKU per line. Smart Target reads what is saved here." icon={<ListChecks className="h-5 w-5" />} className="mb-0 border-b pb-3" />}
        <RegisterFillTimeCard />
        <SkuFillTimesCard initialStatus="approved" tall />
      </div>
  );
  return embedded ? body : <DashboardLayout>{body}</DashboardLayout>;
}
