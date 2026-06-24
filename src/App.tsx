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
const IntouchIntegrationPage = lazy(() => import("./pages/dashboard/IntouchIntegrationPage"));
const PreventiveMaintenancePage = lazy(() => import("./pages/dashboard/PreventiveMaintenancePage"));
const SettingsPage = lazy(() => import("./pages/dashboard/SettingsPage"));

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

const roleDashMap = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  operator: "/dashboard/operator",
} as const;

const SessionRedirect = () => {
  const { session, role, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
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
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ManagerDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/analytics"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <AnalyticsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/financial"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <FinancialDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/work-orders"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <WorkOrdersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/machines"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <MachinesPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/problems"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ProblemsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/control-center"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ControlCenterPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/machines/:name/history"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
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
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <DowntimePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/intouch"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <IntouchIntegrationPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/preventive"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "engineer"]}>
                      <PreventiveMaintenancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/reliability"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <ReliabilityDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/wo/:id"
                  element={
                    <ProtectedRoute allowedRoles={["operator", "engineer", "admin", "manager"]}>
                      <WorkOrderDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/stock"
                  element={
                    <ProtectedRoute allowedRoles={["engineer", "admin", "manager"]}>
                      <StockPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/users/manage"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
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
                <Route path="/" element={<SessionRedirect />} />
                <Route path="*" element={<SessionRedirect />} />
              </Routes>
            </Suspense>
          </CriticalAlertProvider>
          </LanguageProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
