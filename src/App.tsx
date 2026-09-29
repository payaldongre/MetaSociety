import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import DataIntelligence from "@/pages/DataIntelligence";
import AIAdvisor from "@/pages/AIAdvisor";
import SimulationLab from "@/pages/SimulationLab";
import Alerts from "@/pages/Alerts";
import SavedReports from "@/pages/SavedReports";
import Profile from "@/pages/Profile";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/data-intelligence" element={<DataIntelligence />} />
              <Route path="/ai-advisor" element={<AIAdvisor />} />
              <Route path="/simulation-lab" element={<SimulationLab />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/saved-reports" element={<SavedReports />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
