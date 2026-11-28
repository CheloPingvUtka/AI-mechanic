import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Ban, BookOpen, CheckCircle2, Circle, Fuel, Gauge, Hash, ImageOff, Lightbulb, Loader2, Ruler, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, useLoad } from "../../lib/api";
import type { Dispute } from "../../types/domain";

const ICONS: Record<string, ReactNode> = {
  contradiction: <Scale size={24}/>, unverified_numbers: <Hash size={24}/>, ticket_rejected: <Ban size={24}/>,
  low_confidence: <Gauge size={24}/>, fuel_mismatch: <Fuel size={24}/>, photo_mismatch: <ImageOff size={24}/>,
  measure_skipped: <Ruler size={24}/>,
};

/** Where a dispute happened: a conflict between manuals is shown in its repair (preparation stage, highlighted);
 *  a doubtful answer opens the repair with its chat; a doubtful check opens the anamnesis with that check. */
export function disputeTarget(d: Dispute): string {
  const v = encodeURIComponent(d.vehicle_id);
  const repair = !!d.work_id && (d.work_status === "active" || d.work_status === "done");
  if (repair && d.kind === "contradiction") return `/?vehicle=${v}&step=work&work=${d.work_id}&dispute=${d.id}`;
  if (repair && d.kind === "measure_skipped") return `/?vehicle=${v}&step=work&work=${d.work_id}&dispute=${d.id}`;
  if (repair && ["unverified_numbers", "photo_mismatch", "ticket_rejected"].includes(d.kind))
    return `/?vehicle=${v}&step=result&work=${d.work_id}&chat=1`;
  const session = d.session_id ?? (typeof d.data?.session_id === "string" ? d.data.session_id : null);
  return `/?vehicle=${v}&step=result${session ? `&session=${encodeURIComponent(session)}` : ""}`;
}

/** Chief mechanic's journal: where the AI was unsure or the manuals disagree. Unresolved first; one tap marks it resolved. */
export default function DisputesPage() {
  const { t } = useTranslation();
  const { data, error } = useLoad(api.disputes);
  const [resolved, setResolved] = useState<Record<number, boolean>>({});  // taps not yet reloaded
  const kindLabel: Record<string, string> = {
    contradiction: t("dispute.contradiction", "Руководства расходятся"),
    unverified_numbers: t("dispute.unverified_numbers", "Числа без источника"),
    ticket_rejected: t("dispute.ticket_rejected", "Заявка не прошла проверку"),
    low_confidence: t("dispute.low_confidence", "Низкая уверенность"),
    fuel_mismatch: t("dispute.fuel_mismatch", "Неисправность не для этого двигателя"),
    photo_mismatch: t("dispute.photo_mismatch", "Фото не того двигателя"),
    measure_skipped: t("dispute.measure_skipped", "Замеры пропущены"),
  };
  const list = [...(data ?? [])].sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.created_at - a.created_at);
  const isResolved = (d: Dispute) => resolved[d.id] ?? d.resolved;
  async function toggle(d: Dispute) {
    const next = !isResolved(d);
    setResolved(r => ({ ...r, [d.id]: next }));
    try { await api.resolveDispute(d.id, next); } catch { setResolved(r => ({ ...r, [d.id]: !next })); }
  }

  return <div className="disputes">
    <div className="page-heading"><div>
      <h1>{t("dispute.title", "Спорные ситуации")}</h1>
      <p className="muted">{t("dispute.subtitle", "Где ИИ не уверен или руководства расходятся. Разберите и отметьте.")}</p>
    </div>{data && <span className="badge warning">{t("dispute.open", "Не разобрано: {{n}}", { n: list.filter(d => !isResolved(d)).length })}</span>}</div>
    {error && <div className="work-status bad"><AlertTriangle size={28}/><div><b>{error}</b></div></div>}
    {!data && !error && <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("loading", "Загружаем…")}</p>}
    {data && !list.length && <p className="muted">{t("dispute.empty", "Спорных ситуаций нет.")}</p>}
    <ul className="dispute-list">{list.map(d => <li key={d.id} className={`dispute ${isResolved(d) ? "resolved" : ""}`}>
      <span className="tl-icon">{ICONS[d.kind] ?? <AlertTriangle size={24}/>}</span>
      <div className="dispute-body">
        <div className="tl-top"><b>{kindLabel[d.kind] ?? d.kind}</b>
          <time>{new Date(d.created_at * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>
        <b className="dispute-vehicle-id">{d.vehicle_id}</b>
        <p>{d.detail}</p>
        {typeof d.data?.recommendation === "string" && d.data.recommendation && <p className="conflict-rec"><Lightbulb size={18}/>
          <span><b>{t("conflict.recommendation", "Рекомендация ИИ (не из руководства)")}:</b> {d.data.recommendation}</span></p>}
        <div className="dispute-links">
          <Link className="dispute-open" to={disputeTarget(d)}>{t("dispute.goto", "Открыть ситуацию")}<ArrowRight size={20}/></Link>
          <Link className="dispute-book" to={`/book/${d.vehicle_id}`}><BookOpen size={18}/>{t("book.short", "Книжка")}</Link>
        </div>
      </div>
      <button className={`dispute-toggle ${isResolved(d) ? "on" : ""}`} aria-pressed={isResolved(d)} onClick={() => void toggle(d)}>
        {isResolved(d) ? <CheckCircle2 size={26}/> : <Circle size={26}/>}<span>{t("dispute.resolved", "Разобрано")}</span>
      </button>
    </li>)}</ul>
  </div>;
}
