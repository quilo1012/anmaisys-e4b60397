import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, LayoutDashboard, Users, Timer, Activity, Package, AlertTriangle, BarChart3, Cog, AlertCircle, Loader2, Lock, Database } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts } from "@/hooks/useStock";
import { differenceInMinutes } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWOAlerts } from "@/hooks/useWOAlerts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const DONE_STATUSES = ["completed", "closed", "finished"];

export default function ManagerDashboard() {
  const { data: allWOs } = useWorkOrders();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products } = useProducts();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showChangePin, setShowChangePin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [seeding, setSeeding] = useState(false);
  useWOAlerts();

  const isPreview = typeof window !== "undefined" && (
    window.location.hostname.includes("lovable.app") ||
    window.location.hostname.includes("lovableproject.com") ||
    window.location.hostname === "localhost"
  );

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke("seed-demo");
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Seed failed");
      const creds = data.credentials;
      toast({
        title: "Demo data seeded!",
        description: `Manager: ${creds.manager.email} / ${creds.manager.password}\nEngineer: ${creds.engineer.email} / ${creds.engineer.password}\nEngineer PIN: ${creds.engineerPin}`,
      });
      queryClient.invalidateQueries();
    } catch (err: any) {
      toast({ title: "Seed error", description: err.message, variant: "destructive" });
    } finally {
      setSeeding(false);
    }
  };

  const { data: userCount } = useQuery({
    queryKey: ["user_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const today = new Date().toDateString();
  const openCount = allWOs?.filter((w) => w.status === "open").length ?? 0;
  const inProgressCount = allWOs?.filter((w) => w.status === "in_progress").length ?? 0;
  const completedToday = allWOs?.filter((w) => DONE_STATUSES.includes(w.status) && (w.closed_at || w.completed_at || w.finished_at) && new Date(w.closed_at || w.completed_at || w.finished_at!).toDateString() === today).length ?? 0;
  const lowStockCount = products?.filter((p) => p.quantity <= p.min_stock).length ?? 0;

  const kpis = useMemo(() => {
    if (!allWOs) return { avgResponse: 0, avgMTTR: 0 };
    const done = allWOs.filter((w) => DONE_STATUSES.includes(w.status) && w.started_at);
    let totalResp = 0, totalMTTR = 0, count = 0;
    done.forEach((wo) => {
      totalResp += differenceInMinutes(new Date(wo.started_at!), new Date(wo.created_at));
      const end = wo.finished_at || wo.completed_at;
      if (end) {
        totalMTTR += differenceInMinutes(new Date(end), new Date(wo.started_at!));
      }
      count++;
    });
    return { avgResponse: count ? Math.round(totalResp / count) : 0, avgMTTR: count ? Math.round(totalMTTR / count) : 0 };
  }, [allWOs]);

  const handleChangePin = async () => {
    if (newPin.length < 4) {
      toast({ title: "PIN too short", description: "PIN must be at least 4 characters.", variant: "destructive" });
      return;
    }
    if (newPin !== confirmPin) {
      toast({ title: "PINs don't match", description: "Please confirm the new PIN.", variant: "destructive" });
      return;
    }
    setSavingPin(true);
    try {
      const { data, error } = await supabase.functions.invoke("update-admin-pin", {
        body: { newPin },
      });
      if (error) throw error;
      if (!data?.success) throw new Error("Failed to update PIN");
      toast({ title: "PIN updated", description: "The admin PIN has been changed successfully." });
      setShowChangePin(false);
      setNewPin("");
      setConfirmPin("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingPin(false);
    }
  };

  const quickLinks = [
    { title: "Analytics", desc: "Charts & performance", icon: BarChart3, url: "/dashboard/analytics" },
    { title: "Work Orders", desc: "Table & Kanban", icon: ClipboardList, url: "/dashboard/work-orders" },
    { title: "Machines", desc: "Manage machines", icon: Cog, url: "/dashboard/machines" },
    { title: "Problems", desc: "Problem descriptions", icon: AlertCircle, url: "/dashboard/problems" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Manager Dashboard</h2>
            <p className="text-muted-foreground">System overview and quick access</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowChangePin(true)}>
            <Lock className="h-4 w-4 mr-2" /> Change PIN
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Open WOs</CardTitle><ClipboardList className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{openCount}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">In Progress</CardTitle><LayoutDashboard className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{inProgressCount}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Completed Today</CardTitle><ClipboardList className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{completedToday}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Users</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{userCount ?? "—"}</div></CardContent></Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg Response</CardTitle><Timer className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgResponse} min</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg MTTR</CardTitle><Activity className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgMTTR} min</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Parts Today</CardTitle><Package className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{partsToday ?? 0}</div></CardContent></Card>
          <Card className={lowStockCount > 0 ? "border-destructive" : ""}><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Low Stock</CardTitle><AlertTriangle className={`h-4 w-4 ${lowStockCount > 0 ? "text-destructive" : "text-muted-foreground"}`} /></CardHeader><CardContent><div className={`text-2xl font-bold ${lowStockCount > 0 ? "text-destructive" : ""}`}>{lowStockCount}</div></CardContent></Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((link) => (
            <Card key={link.url} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(link.url)}>
              <CardContent className="pt-6 flex items-center gap-4">
                <div className="p-2 rounded-lg bg-primary/10">
                  <link.icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{link.title}</p>
                  <p className="text-sm text-muted-foreground">{link.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog open={showChangePin} onOpenChange={(o) => { setShowChangePin(o); if (!o) { setNewPin(""); setConfirmPin(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Admin PIN</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-pin">New PIN</Label>
                <Input id="new-pin" type="password" placeholder="Enter new PIN..." value={newPin} onChange={(e) => setNewPin(e.target.value)} maxLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-pin">Confirm PIN</Label>
                <Input id="confirm-pin" type="password" placeholder="Confirm new PIN..." value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} maxLength={8} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowChangePin(false)}>Cancel</Button>
              <Button onClick={handleChangePin} disabled={savingPin || newPin.length < 4}>
                {savingPin && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save PIN
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
