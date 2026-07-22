import { ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { QualityActionsView } from "./QualityActionsPage";

export default function QualityPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Quality</h1>
        </div>

        <QualityActionsView />
      </div>
    </DashboardLayout>
  );
}
