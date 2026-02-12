import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import OperatorDashboard from "./pages/dashboard/OperatorDashboard";
import EngineerDashboard from "./pages/dashboard/EngineerDashboard";
import ManagerDashboard from "./pages/dashboard/ManagerDashboard";
import AnalyticsPage from "./pages/dashboard/AnalyticsPage";
import WorkOrdersPage from "./pages/dashboard/WorkOrdersPage";
import MachinesPage from "./pages/dashboard/MachinesPage";
import ProblemsPage from "./pages/dashboard/ProblemsPage";
import WorkOrderDetail from "./pages/dashboard/WorkOrderDetail";
import StockPage from "./pages/dashboard/StockPage";
import AuditLogsPage from "./pages/dashboard/AuditLogsPage";
import ManageUsers from "./pages/users/ManageUsers";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard/operator" element={<ProtectedRoute allowedRoles={["operator"]}><OperatorDashboard /></ProtectedRoute>} />
            <Route path="/dashboard/engineer" element={<ProtectedRoute allowedRoles={["engineer"]}><EngineerDashboard /></ProtectedRoute>} />
            <Route path="/dashboard/manager" element={<ProtectedRoute allowedRoles={["admin"]}><ManagerDashboard /></ProtectedRoute>} />
            <Route path="/dashboard/analytics" element={<ProtectedRoute allowedRoles={["admin"]}><AnalyticsPage /></ProtectedRoute>} />
            <Route path="/dashboard/work-orders" element={<ProtectedRoute allowedRoles={["admin"]}><WorkOrdersPage /></ProtectedRoute>} />
            <Route path="/dashboard/machines" element={<ProtectedRoute allowedRoles={["admin"]}><MachinesPage /></ProtectedRoute>} />
            <Route path="/dashboard/problems" element={<ProtectedRoute allowedRoles={["admin"]}><ProblemsPage /></ProtectedRoute>} />
            <Route path="/dashboard/audit-logs" element={<ProtectedRoute allowedRoles={["admin"]}><AuditLogsPage /></ProtectedRoute>} />
            <Route path="/dashboard/wo/:id" element={<ProtectedRoute allowedRoles={["operator", "engineer", "admin"]}><WorkOrderDetail /></ProtectedRoute>} />
            <Route path="/dashboard/stock" element={<ProtectedRoute allowedRoles={["engineer", "admin"]}><StockPage /></ProtectedRoute>} />
            <Route path="/users/manage" element={<ProtectedRoute allowedRoles={["admin"]}><ManageUsers /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
