import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import MechanicPage from "../features/diagnostics/MechanicPage";
import FleetPage from "../features/fleet/FleetPage";
import TicketPage from "../features/tickets/TicketPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<MechanicPage />} />
        <Route path="/fleet" element={<FleetPage />} />
        <Route path="/tickets" element={<TicketPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}