import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import ErrorBoundary from "../components/ErrorBoundary";
import MechanicPage from "../features/diagnostics/MechanicPage";
import FleetPage from "../features/fleet/FleetPage";
import TicketPage from "../features/tickets/TicketPage";

export default function App() {
  const location = useLocation();
  return (
    <AppShell>
      <ErrorBoundary resetKey={location.pathname + location.search}>
        <Routes>
          <Route path="/" element={<MechanicPage />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/tickets" element={<TicketPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}
