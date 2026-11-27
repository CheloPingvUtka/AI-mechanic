import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import ErrorBoundary from "../components/ErrorBoundary";
import WizardPage from "../features/wizard/WizardPage";
import MechanicPage from "../features/diagnostics/MechanicPage";
import FleetPage from "../features/fleet/FleetPage";
import TicketPage from "../features/tickets/TicketPage";
import BookPage from "../features/book/BookPage";
import DisputesPage from "../features/disputes/DisputesPage";

export default function App() {
  const location = useLocation();
  return (
    <AppShell>
      <ErrorBoundary resetKey={location.pathname + location.search}>
        <Routes>
          <Route path="/" element={<WizardPage />} />
          <Route path="/detail" element={<MechanicPage />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/tickets" element={<TicketPage />} />
          <Route path="/book/:vehicleId" element={<BookPage />} />
          <Route path="/disputes" element={<DisputesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}
