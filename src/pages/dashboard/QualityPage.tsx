import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { cn } from "@/lib/utils";
import { QualityActionsView } from "./QualityActionsPage";
import { QualityReportView } from "./QualityWeeklyReportPage";
import { QCChecksView } from "./QCChecksPage";
import { AuditsView } from "./AuditsPage";

type QualityTab = "actions" | "checks" | "audits" | "report";
const VALID_TABS: QualityTab[] = ["actions", "checks", "audits", "report"];

export default function QualityPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const initial: QualityTab = (VALID_TABS as string[]).includes(tabParam ?? "") ? (tabParam as QualityTab) : "actions";
  const [tab, setTab] = useState<QualityTab>(initial);

  const select = (t: QualityTab) => {
    setTab(t);
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };

  const tabBtn = (t: QualityTab, label: string) => (
    <button
      type="button"
      onClick={() => select(t)}
      className={cn(
        "rounded px-4 py-1.5 text-sm font-medium transition-colors",
        tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Quality</h1>
          </div>
          <div className="inline-flex rounded-md border p-0.5">
            {tabBtn("actions", "Actions")}
            {tabBtn("checks", "QC Checks")}
            {tabBtn("audits", "Audits")}
            {tabBtn("report", "Report Analytics")}
          </div>
        </div>

        {tab === "actions" ? <QualityActionsView /> : tab === "checks" ? <QCChecksView /> : tab === "audits" ? <AuditsView /> : <QualityReportView />}
      </div>
    </DashboardLayout>
  );
}
