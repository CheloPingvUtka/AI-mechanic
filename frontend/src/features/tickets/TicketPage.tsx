import { Link } from "react-router-dom";
import { AlertTriangle, BookOpen, Loader2, ShieldAlert } from "lucide-react";
import { api, URGENCY_LABEL, useLoad } from "../../lib/api";

const URGENCY_BADGE = { high: "danger", medium: "warning", low: "info" } as const;

export default function TicketPage() {
  const { data: tickets, error } = useLoad(api.tickets);
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">ТОиР</p><h1>Заявки на дефектовку</h1><p className="muted">Заявки, которые агент передал в ТОиР с момента запуска. Создаются в рабочем месте по команде механика.</p></div></div>
    {error && <div className="notice warning-notice"><AlertTriangle/><div><b>Нет связи с backend</b><p>{error}</p></div></div>}
    {!tickets && !error && <p className="muted"><Loader2 size={14} className="spin"/> Загружаем…</p>}
    {tickets?.length === 0 && <section className="panel"><p className="muted">Заявок пока нет. Получите результат проверки в <Link to="/">рабочем месте</Link> и попросите агента создать заявку.</p></section>}
    {[...(tickets ?? [])].reverse().map(t => <section className="panel ticket-card" key={t.ticket_id}>
      <div className="panel-heading"><div><p className="eyebrow">{t.vehicle_id} · {t.session_id} · {t.anomaly_type}</p><h2>{t.ticket_id}</h2></div><span className={`badge ${URGENCY_BADGE[t.urgency]}`}>{URGENCY_LABEL[t.urgency]}</span></div>
      {t.operation_ban && <div className="notice danger-notice"><ShieldAlert/><div><b>Руководство запрещает эксплуатацию</b><p>«{t.operation_ban.quote}» — {t.operation_ban.manual}, стр. {t.operation_ban.pdf_page}</p></div></div>}
      <p>{t.conclusion}</p>
      <ol>{t.operations.map(o => <li key={o}>{o}</li>)}</ol>
      {!!t.spare_parts.length && <p className="muted">Запчасти: {t.spare_parts.join(", ")}</p>}
      {t.references.map(r => <p key={r.manual + r.pdf_page} className="demo-source"><BookOpen size={14}/> {r.manual} · стр. PDF {r.pdf_page}</p>)}
    </section>)}
  </div>;
}
