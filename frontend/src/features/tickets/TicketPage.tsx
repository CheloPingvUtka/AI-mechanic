import { Link } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, useLoad } from "../../lib/api";
import TicketCard from "../session/TicketCard";

export default function TicketPage() {
  const { t } = useTranslation();
  const { data: tickets, error } = useLoad(api.tickets);
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">{t("tickets.eyebrow", "ТОиР")}</p><h1>{t("tickets.title", "Заявки на дефектовку")}</h1>
      <p className="muted">{t("tickets.subtitle", "Заявки, которые агент передал в ТОиР с момента запуска. Создаются в рабочем месте по команде механика.")}</p></div></div>
    {error && <div className="notice warning-notice"><AlertTriangle/><div><b>{t("noBackend", "Нет связи с сервером")}</b><p>{error}</p></div></div>}
    {!tickets && !error && <p className="muted"><Loader2 size={14} className="spin"/> {t("loading", "Загружаем…")}</p>}
    {tickets?.length === 0 && <section className="panel"><p className="muted">{t("tickets.empty", "Заявок пока нет. Получите результат проверки и попросите агента создать заявку.")} <Link to="/">{t("nav.work", "Работа")}</Link></p></section>}
    {[...(tickets ?? [])].reverse().map(tk => <div key={tk.ticket_id}>
      <h2 className="ticket-heading">{tk.ticket_id} · {tk.vehicle_id}</h2>
      <TicketCard ticket={tk} created={false}/>
    </div>)}
  </div>;
}
