import { Suspense, useEffect } from "react";
import { installTelemetryHandlers, setTelemetryContext } from "@/lib/telemetry";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { reportQueryError } from "@/lib/queryErrors";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
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
import { useSeverityPointsSync } from "@/hooks/useSeverityPoints";

function PermissionOverridesSync() {
  usePermissionOverridesSync();
  return null;
}

/** Loads the configured quality severity weights so scores match what Quality set. */
function SeverityPointsSync() {
  useSeverityPointsSync();
  return null;
}

// Installs global error capture, keeps the telemetry context (user+role) fresh,
// and opens the admin-only Root Diagnostics console on Ctrl/Cmd+Shift+D.
function TelemetryInit() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { installTelemetryHandlers(); }, []);
  useEffect(() => { setTelemetryContext(user?.id ?? null, role ?? null); }, [user?.id, role]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d") && role === "admin") {
        e.preventDefault();
        navigate("/dashboard/root-diagnostics");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [role, navigate]);
  return null;
}

const OperatorDashboard = lazyWithReload(() => import("./pages/dashboard/OperatorDashboard"));
const EngineerDashboard = lazyWithReload(() => import("./pages/dashboard/EngineerDashboard"));
const ManagerDashboard = lazyWithReload(() => import("./pages/dashboard/ManagerDashboard"));

const MachineHistoryPage = lazyWithReload(() => import("./pages/dashboard/MachineHistoryPage"));
const ControlCenterPage = lazyWithReload(() => import("./pages/dashboard/ControlCenterPage"));
const AnalyticsPage = lazyWithReload(() => import("./pages/dashboard/AnalyticsPage"));
const WorkOrdersPage = lazyWithReload(() => import("./pages/dashboard/WorkOrdersPage"));
const MachinesPage = lazyWithReload(() => import("./pages/dashboard/MachinesPage"));
const ProblemsPage = lazyWithReload(() => import("./pages/dashboard/ProblemsPage"));
const WorkOrderDetail = lazyWithReload(() => import("./pages/dashboard/WorkOrderDetail"));
const StockPage = lazyWithReload(() => import("./pages/dashboard/StockPage"));
const AuditLogsPage = lazyWithReload(() => import("./pages/dashboard/AuditLogsPage"));
const SystemHubPage = lazyWithReload(() => import("./pages/dashboard/SystemHubPage"));
const ReportsPage = lazyWithReload(() => import("./pages/dashboard/ReportsPage"));
const AttendancePage = lazyWithReload(() => import("./pages/dashboard/AttendancePage"));
const FinanceClosePage = lazyWithReload(() => import("./pages/dashboard/FinanceClosePage"));
const LeavePage = lazyWithReload(() => import("./pages/dashboard/LeavePage"));
const WorkforcePage = lazyWithReload(() => import("./pages/dashboard/WorkforcePage"));
const ProductionHeadcountPage = lazyWithReload(() => import("./pages/dashboard/ProductionHeadcountPage"));

const ReliabilityDashboard = lazyWithReload(() => import("./pages/dashboard/ReliabilityDashboard"));
const ManageUsers = lazyWithReload(() => import("./pages/users/ManageUsers"));
const DowntimePage = lazyWithReload(() => import("./pages/dashboard/DowntimePage"));

const PreventiveMaintenancePage = lazyWithReload(() => import("./pages/dashboard/PreventiveMaintenancePage"));
const SettingsPage = lazyWithReload(() => import("./pages/dashboard/SettingsPage"));
const OperatorChatSettingsPage = lazyWithReload(() => import("./pages/dashboard/OperatorChatSettingsPage"));
const ShiftPasswordSettingsPage = lazyWithReload(() => import("./pages/dashboard/ShiftPasswordSettingsPage"));
const SuppliersPage = lazyWithReload(() => import("./pages/dashboard/SuppliersPage"));

const SKUProductsPage = lazyWithReload(() => import("./pages/dashboard/SKUProductsPage"));
const ProductionPerformancePage = lazyWithReload(() => import("./pages/dashboard/ProductionPerformancePage"));



const WarehouseDashboard = lazyWithReload(() => import("./pages/dashboard/WarehouseDashboard"));

const QualityPage = lazyWithReload(() => import("./pages/dashboard/QualityPage"));
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
const RootDiagnosticsPage = lazyWithReload(() => import("./pages/dashboard/RootDiagnosticsPage"));

const queryClient = new QueryClient({
  // Until now a denied or failed request died quietly: the fetch wrapper logged it,
  // React Query put the screen into an error state, and most screens render nothing
  // for that state. A policy that says no, a dropped connection and an empty table
  // all looked identical.
  queryCache: new QueryCache({ onError: (error) => { reportQueryError(error); } }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // A mutation with its own onError is already telling the user in its own words.
      if (mutation.options.onError) return;
      reportQueryError(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      // Refetch when the tablet/app regains focus or reconnects, so screens
      // don't sit on stale data until a manual refresh.
      refetchOnWindowFocus: true,
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



/** Sends /dashboard/work-orders/<id> to the order's real route, preserving history. */
const LegacyWoLinkRedirect = () => {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/dashboard/wo/${id}`} replace />;
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
          <WifiOff className="mx-auto h-10 w-10 text-warning-strong" />
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

const AppUpdater = () => {
  const { updateReady, reloadNow } = useAppUpdater();
  if (!updateReady) return null;
  // Prominent, unmissable top banner (kiosk tablets miss subtle toasts). The app
  // still auto-reloads once idle, but this lets the person update on demand
  // instead of ending up stuck on a stale build.
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[200] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2.5 text-primary-foreground shadow-lg"
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <RefreshCw className="h-4 w-4 shrink-0" />
        A new version is available
      </span>
      <button
        onClick={reloadNow}
        className="rounded-md bg-primary-foreground px-3 py-1 text-xs font-bold text-primary hover:opacity-90"
      >
        Update now
      </button>
    </div>
  );
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
            <AppUpdater />
            <PermissionOverridesSync />
            <SeverityPointsSync />
            <TelemetryInit />
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
                {/* Old deep link shape. The iTouching functions wrote
                    action_url: /dashboard/work-orders/<id> into every notification —
                    190 of them — and that path matches no route, so the push a phone
                    already holds lands on the catch-all instead of the order. The
                    functions now write /dashboard/wo/<id>; this keeps every link
                    already sent working. */}
                <Route path="/dashboard/work-orders/:id" element={<LegacyWoLinkRedirect />} />
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
                {/* There is one landing screen per role now. The separate welcome page
                    it used to serve was merged into the Dashboard; this keeps every
                    link, bookmark and the mobile Home tab working. */}
                <Route path="/dashboard/home" element={<SessionRedirect />} />
                <Route
                  path="/dashboard/machines/:name/history"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "maintenance_manager", "planner"]} requiredAction="machines.view">
                      <MachineHistoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/workforce"
                  element={
                    <ProtectedRoute requiredAction="workforce.view">
                      <WorkforcePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/headcount"
                  element={
                    <ProtectedRoute requiredAction="headcount.view">
                      <ProductionHeadcountPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/leave"
                  element={
                    <ProtectedRoute requiredAction="workforce.view">
                      <LeavePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/finance-close"
                  element={
                    <ProtectedRoute requiredAction="workforce.view">
                      <FinanceClosePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/attendance"
                  element={
                    <ProtectedRoute requiredAction="workforce.view">
                      <AttendancePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/reports"
                  element={
                    <ProtectedRoute requiredAction="reports.analytics">
                      <ReportsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/system"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <SystemHubPage />
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
                  path="/dashboard/operator-chat-settings"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager"]}>
                      <OperatorChatSettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/shift-password-settings"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <ShiftPasswordSettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/root-diagnostics"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]}>
                      <RootDiagnosticsPage />
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
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor"]} requiredAction="sku.manage">
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
                  path="/dashboard/quality"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "manager", "supervisor", "quality_supervisor"]} requiredAction="quality.view">
                      <QualityPage />
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
