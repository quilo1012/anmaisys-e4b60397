import { DashboardLayout } from "@/components/DashboardLayout";
import { QualityActionsView } from "./QualityActionsPage";

/**
 * Landing screen for the quality supervisor.
 *
 * The header lives inside the view, not here: the toolbar beside it — the view
 * toggle, the reports menu, Log action — is driven by the view's own state, and
 * split across two components it could only sit on a row of its own, right-aligned
 * against a title it belongs to.
 */
export default function QualityPage() {
  return (
    <DashboardLayout>
      <QualityActionsView />
    </DashboardLayout>
  );
}
