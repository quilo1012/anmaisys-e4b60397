import { Suspense } from "react";
import { lazyWithReload } from "@/lib/lazyWithReload";
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
import SignUp from "./pages/SignUp";
import OAuthConsent from "./pages/OAuthConsent";
import ResetPassword from "./pages/ResetPassword";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { RefreshCw, WifiOff } from "lucide-react";
import { roleDashMap } from "@/lib/permissions";
import { usePermissionOverridesSync } from "@/hooks/usePermissionOverrides";

function PermissionOverridesSync() {
  usePermissionOverridesSync();
  return null;
}

const OperatorDashboard = lazyWithReload(() => import("./pages/dashboard/OperatorDashboard"));
const EngineerDashboard = lazyWithReload(() => import("./pages/dashboard/EngineerDashboard"));
const ManagerDashboard = lazyWithReload(() => import("./pages/dashboard/ManagerDashboard"));

const MachineHistoryPage = lazyWithReload(() => import("./pages/dashboard/MachineHistoryPage"));
const ControlCenterPage = lazyWithReload(() => import("./pages/dashboard/ControlCenterPage"));
const MobileHome = lazyWithReload(() => import("./pages/dashboard/MobileHome"));
const AnalyticsPage = lazyWithReload(() => import("./pages/dashboard/AnalyticsPage"));
const WorkOrdersPage = lazyWithReload(() => import("./pages/dashboard/WorkOrdersPage"));
const MachinesPage = lazyWithReload(() => import("./pages/dashboard/MachinesPage"));
const ProblemsPage = lazyWithReload(() => import("./pages/dashboard/ProblemsPage"));
const WorkOrderDetail = lazyWithReload(() => import("./pages/dashboard/WorkOrderDetail"));
const StockPage = lazyWithReload(() => import("./pages/dashboard/StockPage"));
const AuditLogsPage = lazyWithReload(() => import("./pages/dashboard/AuditLogsPage"));

const ReliabilityDashboard = lazyWithReload(() => import("./pages/dashboard/ReliabilityDashboard"));
const ManageUsers = lazyWithReload(() => import("./pages/users/ManageUsers"));
const DowntimePage = lazyWithReload(() => import("./pages/dashboard/DowntimePage"));

const PreventiveMaintenancePage = lazyWithReload(() => import("./pages/dashboard/PreventiveMaintenancePage"));
const SettingsPage = lazyWithReload(() => import("./pages/dashboard/SettingsPage"));
const SuppliersPage = lazyWithReload(() => import("./pages/dashboard/SuppliersPage"));

const SKUProductsPage = lazyWithReload(() => import("./pages/dashboard/SKUProductsPage"));
const ProductionPerformancePage = lazyWithReload(() => import("./pages/dashboard/ProductionPerformancePage"));
const SKUPerformancePage = lazyWithReload(() => import("./pages/dashboard/SKUPerformancePage"));



const WarehouseDashboard = lazyWithReload(() => import("./pages/dashboard/WarehouseDashboard"));

const QualityPage = lazyWithReload(() => import("./pages/dashboard/QualityPage"));
const PackagingPage = lazyWithReload(() => import("./pages/dashboard/PackagingPage"));
const ShiftHistoryPage = lazyWithReload(() => import("./pages/dashboard/ShiftHistoryPage"));


const RAGWeeklyPage = lazyWithReload(() => import("./pages/dashboard/RAGWeeklyPage"));
const IntouchSettingsPage = lazyWithReload(() => import("./pages/dashboard/IntouchSettingsPage"));
const LineProductionScreen = lazyWithReload(() => import("./pages/dashboard/LineProductionScreen"));
const LineDisplayScreen = lazyWithReload(() => import("./pages/dashboard/LineDisplayScreen"));
const LineHubScreen = lazyWithReload(() => import("./pages/dashboard/LineHubScreen"));
const IntouchMachineMapPage = lazyWithReload(() => import("./pages/dashboard/IntouchMachineMapPage"));
const IntouchStopCodesPage = lazyWithReload(() => import("./pages/dashboard/IntouchStopCodesPage"));
// DowntimeHeatmapPage consolidated into DowntimePage as the "Heatmap" tab.
const PMIntelligencePage = lazyWithReload(() => import("./pages/dashboard/PMIntelligencePage"));



const MyProductionPage = lazyWithReload(() => import("./pages/dashboard/MyProductionPage"));
const OperatorPerformancePage = lazyWithReload(() => import("./pages/dashboard/OperatorPerformancePage"));
const DirectMessagesPage = lazyWithReload(() => import("./pages/dashboard/DirectMessagesPage"));
const PermissionsMatrixPage = lazyWithReload(() => import("./pages/dashboard/PermissionsMatrixPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number; statusCode?: number } | null)?.status
          ?? (error as { statusCode?: number } | null)?.statusCode;
        // Don't retry auth / permission / not-found errors
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      retry: 0,
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
            <PermissionOverridesSync />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<SignUp />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                <Route
                  path="/dashboard/operator"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "operator", "engineer", "maintenance_manager"]} requiredAction="dashboard.operator">
                      <OperatorDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/operator/my-production"
                  element={
                    <ProtectedRoute allowedRoles={["operator"]} requiredAction="production.target.view">
                      <MyProductionPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/operator/performance"
                  element={
                    <ProtectedRoute allowedRoles={["operator"]} requiredAction="production.performance.view">
                      <OperatorPerformancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/warehouse"
                  element={
                    <ProtectedRoute allowedRoles={["warehouse", "admin"]}>
                      <WarehouseDashboard />
                    </ProtectedRoute>
                  }
                />






                <Route
                  path="/dashboard/engineer"
                  element={
                    <ProtectedRoute allowedRoles={["engineer", "co_engineer", "admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="dashboard.engineer">
                      <EngineerDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/manager"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner", "viewer"]} requiredAction="dashboard.manager">
                      <ManagerDashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/dashboard/analytics"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor"]} requiredAction="reports.analytics">
                      <AnalyticsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/work-orders"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="wo.view">
                      <WorkOrdersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/machines"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner", "warehouse"]} requiredAction="machines.view">
                      <MachinesPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/problems"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="problems.view">
                      <ProblemsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/control-center"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="controlcenter.view">
                      <ControlCenterPage />
                    </ProtectedRoute>
                  }
                />
                {/* Mobile welcome home — available to any signed-in user (mobile shell landing). */}
                <Route
                  path="/dashboard/home"
                  element={
                    <ProtectedRoute>
                      <MobileHome />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/machines/:name/history"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="machines.view">
                      <MachineHistoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/audit-logs"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} requiredAction="audit.view">
                      <AuditLogsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/downtime"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="downtime.view">
                      <DowntimePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/preventive"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "engineer", "co_engineer", "maintenance_manager", "planner"]} requiredAction="pm.view">
                      <PreventiveMaintenancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/reliability"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="reliability.view">
                      <ReliabilityDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/wo/:id"
                  element={
                    <ProtectedRoute allowedRoles={["operator", "engineer", "co_engineer", "admin", "manager", "supervisor", "maintenance_manager", "planner", "warehouse"]} requiredAction="wo.view">
                      <WorkOrderDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/stock"
                  element={
                    <ProtectedRoute allowedRoles={["engineer", "co_engineer", "admin", "manager", "supervisor", "maintenance_manager", "planner", "warehouse"]} requiredAction="stock.view">
                      <StockPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/users/manage"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]} requiredAction="users.manage">
                      <ManageUsers />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/users"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} requiredAction="users.manage">
                      <ManageUsers />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/permissions"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} requiredAction="permissions.manage">
                      <PermissionsMatrixPage />
                    </ProtectedRoute>
                  }
                />


                <Route
                  path="/dashboard/settings"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} requiredAction="system.settings">
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/suppliers"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="suppliers.view">
                      <SuppliersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/sku-products"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]} requiredAction="sku.manage">
                      <SKUProductsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/production-performance"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor"]} requiredAction="production.performance.view">
                      <ProductionPerformancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/sku-performance"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor"]} requiredAction="production.sku_performance.view">
                      <SKUPerformancePage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/dashboard/quality"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "quality_supervisor"]} requiredAction="quality.view">
                      <QualityPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/packaging"
                  element={
                    <ProtectedRoute requiredAction="production.view">
                      <PackagingPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/quality-report"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "quality_supervisor"]} requiredAction="quality.view">
                      <Navigate to="/dashboard/quality" replace />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/shift-history"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor"]} requiredAction="production.manage">
                      <ShiftHistoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/rag-weekly"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="rag.view">
                      <RAGWeeklyPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/line-production"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "engineer", "co_engineer", "maintenance_manager", "planner"]} requiredAction="production.manage">
                      <LineProductionScreen />
                    </ProtectedRoute>
                  }
                />
                <Route path="/dashboard/line-hub" element={<Navigate to="/dashboard/operator" replace />} />

                <Route
                  path="/dashboard/line-display"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "operator", "engineer", "co_engineer", "maintenance_manager", "planner"]} requiredAction="production.view">
                      <LineDisplayScreen />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/dashboard/intouch-settings"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} requiredAction="intouch.manage">
                      <IntouchSettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/intouch-machines"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} requiredAction="intouch.manage">
                      <IntouchMachineMapPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/intouch-stop-codes"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} requiredAction="intouch.manage">
                      <IntouchStopCodesPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/downtime-map"
                  element={<Navigate to="/dashboard/downtime" replace />}
                />

                <Route
                  path="/dashboard/pm-intelligence"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="pm.view">
                      <PMIntelligencePage />
                    </ProtectedRoute>
                  }
                />
                {/* Messages temporarily disabled — re-enable by restoring the ProtectedRoute + chat.dm roles */}
                <Route
                  path="/dashboard/messages"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "operator"]} requiredAction="chat.dm">
                      <DirectMessagesPage />
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
