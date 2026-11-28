import { BookOpen, CheckCircle2, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Ticket } from "../../types/domain";
import { urgencyLabel } from "./ResultCard";

export default function TicketCard({ ticket, created = true }: { ticket: Ticket; created?: boolean }) {
  const { t } = useTranslation();
  return <section className="panel ticket-card">
    {created && <div className="notice success-notice"><CheckCircle2/><div>
      <b>{t("ticket.created", "Заявка {{id}} создана", { id: ticket.ticket_id })}</b>
      <p>{t("ticket.priority", "Приоритет")}: {urgencyLabel(t, ticket.urgency)} · {ticket.anomaly_type} · {ticket.session_id}</p></div></div>}
    {ticket.operation_ban && <div className="notice danger-notice"><ShieldAlert/><div>
      <b>{t("ticket.ban", "Руководство запрещает эксплуатацию")}</b>
      <p>«{ticket.operation_ban.quote}» — {ticket.operation_ban.manual}, {t("page", "стр.")} {ticket.operation_ban.pdf_page}</p></div></div>}
    <p className="ticket-conclusion">{ticket.conclusion}</p>
    <ol>{ticket.operations.map(o => <li key={o}>{o}</li>)}</ol>
    {!!ticket.spare_parts.length && <p className="muted">{t("ticket.parts", "Запчасти")}: {ticket.spare_parts.join(", ")}</p>}
    {ticket.references.map(r => <p key={r.manual + r.pdf_page} className="demo-source"><BookOpen size={14}/> {r.manual} · {t("page", "стр.")} {r.pdf_page}</p>)}
  </section>;
}
