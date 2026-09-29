import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import TopNav from "./TopNav";

export default function AppLayout() {
  const { user } = useAuth();

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background transition-colors duration-500">
      <TopNav />
      <main className="container py-6">
        <Outlet />
      </main>
    </div>
  );
}
