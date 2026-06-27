import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CriticalAlertProvider } from "@/contexts/CriticalAlertContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import Login from "./pages/Login";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { RefreshCw, WifiOff } from "lucide-react";

const OperatorDashboard = lazy(() => import("./pages/dashboard/OperatorDashboard"));
const EngineerDashboard = lazy(() => import("./pages/dashboard/EngineerDashboard"));
const ManagerDashboard = lazy(() => import("./pages/dashboard/ManagerDashboard"));
const FinancialDashboard = lazy(() => import("./pages/dashboard/FinancialDashboard"));
const MachineHistoryPage = lazy(() => import("./pages/dashboard/MachineHistoryPage"));
const ControlCenterPage = lazy(() => import("./pages/dashboard/ControlCenterPage"));
const AnalyticsPage = lazy(() => import("./pages/dashboard/AnalyticsPage"));
const WorkOrdersPage = lazy(() => import("./pages/dashboard/WorkOrdersPage"));
const MachinesPage = lazy(() => import("./pages/dashboard/MachinesPage"));
const ProblemsPage = lazy(() => import("./pages/dashboard/ProblemsPage"));
const WorkOrderDetail = lazy(() => import("./pages/dashboard/WorkOrderDetail"));
const StockPage = lazy(() => import("./pages/dashboard/StockPage"));
const AuditLogsPage = lazy(() => import("./pages/dashboard/AuditLogsPage"));
const ExecutiveDashboard = lazy(() => import("./pages/dashboard/ExecutiveDashboard"));
const ReliabilityDashboard = lazy(() => import("./pages/dashboard/ReliabilityDashboard"));
const ManageUsers = lazy(() => import("./pages/users/ManageUsers"));
const DowntimePage = lazy(() => import("./pages/dashboard/DowntimePage"));

const PreventiveMaintenancePage = lazy(() => import("./pages/dashboard/PreventiveMaintenancePage"));
const SettingsPage = lazy(() => import("./pages/dashboard/SettingsPage"));
const SuppliersPage = lazy(() => import("./pages/dashboard/SuppliersPage"));
const ProductionPlannerPage = lazy(() => import("./pages/dashboard/ProductionPlannerPage"));
const SKUProductsPage = lazy(() => import("./pages/dashboard/SKUProductsPage"));
const ProductionPerformancePage = lazy(() => import("./pages/dashboard/ProductionPerformancePage"));
const SKUEfficiencyPage = lazy(() => import("./pages/dashboard/SKUEfficiencyPage"));
const ProductionForecastPage = lazy(() => import("./pages/dashboard/ProductionForecastPage"));
const ProductionDowntimePage = lazy(() => import("./pages/dashboard/ProductionDowntimePage"));
const QualityActionsPage = lazy(() => import("./pages/dashboard/QualityActionsPage"));
const ShiftHistoryPage = lazy(() => import("./pages/dashboard/ShiftHistoryPage"));
const WeeklyProductionReportPage = lazy(() => import("./pages/dashboard/WeeklyProductionReportPage"));

const RAGWeeklyPage = lazy(() => import("./pages/dashboard/RAGWeeklyPage"));
const IntouchSettingsPage = lazy(() => import("./pages/dashboard/IntouchSettingsPage"));
const LineProductionScreen = lazy(() => import("./pages/dashboard/LineProductionScreen"));
const LineDisplayScreen = lazy(() => import("./pages/dashboard/LineDisplayScreen"));
const LineHubScreen = lazy(() => import("./pages/dashboard/LineHubScreen"));
const IntouchMachineMapPage = lazy(() => import("./pages/dashboard/IntouchMachineMapPage"));
const IntouchStopCodesPage = lazy(() => import("./pages/dashboard/IntouchStopCodesPage"));
const DowntimeHeatmapPage = lazy(() => import("./pages/dashboard/DowntimeHeatmapPage"));
const PMIntelligencePage = lazy(() => import("./pages/dashboard/PMIntelligencePage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
    },
  },
});

const PageLoader = () => (
  <div className="p-8 space-y-4">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-4 w-72" />
    <div className="grid gap-4 md:grid-cols-4 mt-6">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
    <Skeleton className="h-64 mt-4" />
  </div>
);

const roleDashMap: Record<string, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  maintenance_manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  operator: "/dashboard/line-display",
  viewer: "/dashboard/manager",
};

const SessionRedirect = () => {
  const { session, role, loading, authError, retryAuth, signOut } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (authError && !role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <WifiOff className="mx-auto h-10 w-10 text-warning" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">Backend connection is slow</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your session is active, but the system could not load your dashboard permissions yet.
          </p>
          <p className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground break-words">
            {authError}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => void retryAuth()} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await signOut();
                window.location.replace("/login");
              }}
            >
              Back to login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!role) {
    return <PageLoader />;
  }

  return <Navigate to={roleDashMap[role]} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <LanguageProvider>
          <CriticalAlertProvider>
            <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/dashboard/operator"
                  element={
                    <ProtectedRoute allowedRoles={["operator"]}>
                      <OperatorDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/engineer"
                  element={
                    <ProtectedRoute allowedRoles={["engineer"]}>
                      <EngineerDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/manager"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager", "viewer"]}>
                      <ManagerDashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/dashboard/analytics"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <AnalyticsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/financial"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <FinancialDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/work-orders"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <WorkOrdersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/machines"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <MachinesPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/problems"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <ProblemsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/control-center"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <ControlCenterPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/machines/:name/history"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <MachineHistoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/audit-logs"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <AuditLogsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/executive"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <ExecutiveDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/downtime"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <DowntimePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/preventive"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "engineer", "maintenance_manager"]}>
                      <PreventiveMaintenancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/reliability"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <ReliabilityDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/wo/:id"
                  element={
                    <ProtectedRoute allowedRoles={["operator", "engineer", "admin", "manager", "maintenance_manager"]}>
                      <WorkOrderDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/stock"
                  element={
                    <ProtectedRoute allowedRoles={["engineer", "admin", "manager", "maintenance_manager"]}>
                      <StockPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/users/manage"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <ManageUsers />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/users"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <ManageUsers />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/settings"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/suppliers"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <SuppliersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/planner"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ProductionPlannerPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/sku-products"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <SKUProductsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/production-performance"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ProductionPerformancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/sku-efficiency"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <SKUEfficiencyPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/production-downtime"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "engineer", "operator", "maintenance_manager"]}>
                      <ProductionDowntimePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/forecast"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ProductionForecastPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/quality"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <QualityActionsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/shift-history"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ShiftHistoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/weekly-production"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <WeeklyProductionReportPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/rag-weekly"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <RAGWeeklyPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/line-production"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "operator", "engineer", "maintenance_manager"]}>
                      <LineProductionScreen />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/line-display"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "operator", "engineer", "maintenance_manager"]}>
                      <LineDisplayScreen />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/intouch-settings"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <IntouchSettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/intouch-machines"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <IntouchMachineMapPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/intouch-stop-codes"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <IntouchStopCodesPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/downtime-map"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <DowntimeHeatmapPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/pm-intelligence"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "maintenance_manager"]}>
                      <PMIntelligencePage />
                    </ProtectedRoute>
                  }
                />
                <Route path="/" element={<SessionRedirect />} />
                <Route path="*" element={<SessionRedirect />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </CriticalAlertProvider>
          </LanguageProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
