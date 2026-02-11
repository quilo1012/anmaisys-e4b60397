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
import WorkOrderDetail from "./pages/dashboard/WorkOrderDetail";
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
                <ProtectedRoute allowedRoles={["admin"]}>
                  <ManagerDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/wo/:id"
              element={
                <ProtectedRoute allowedRoles={["operator", "engineer", "admin"]}>
                  <WorkOrderDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/users/manage"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <ManageUsers />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
