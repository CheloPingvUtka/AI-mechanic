import { useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import ErrorBoundary from "../components/ErrorBoundary";
import WizardPage from "../features/wizard/WizardPage";
import FleetPage from "../features/fleet/FleetPage";
import TicketPage from "../features/tickets/TicketPage";
import BookPage from "../features/book/BookPage";
import DisputesPage from "../features/disputes/DisputesPage";

export default function App() {
  const location = useLocation();
  // The work screen stays alive (hidden) while another page is open: the service book and back cost
  // nothing, the plan, chat and voice keep their state. It sees the address it had when last shown.
  const onWork = location.pathname === "/";
  const workAt = useRef(location);
  if (onWork) workAt.current = location;
  return (
    <AppShell workTo={workAt.current.pathname === "/" ? workAt.current.pathname + workAt.current.search : "/"}>
      <ErrorBoundary resetKey={location.pathname + location.search}>
        <Routes location={workAt.current}>
          <Route path="/" element={<WizardPage active={onWork} />} />
          <Route path="*" element={null} />
        </Routes>
        <Routes>
          <Route path="/" element={null} />
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
