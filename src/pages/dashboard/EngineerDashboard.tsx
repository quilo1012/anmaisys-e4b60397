import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench } from "lucide-react";

export default function EngineerDashboard() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Engineer Panel</h2>
          <p className="text-muted-foreground">View and execute work orders</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Open Work Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Work orders will be available in Phase 2.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
