import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldAlert, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import MetricCard from "../../components/ui/MetricCard";
import ScoreChart, { trend } from "../../components/ui/ScoreChart";
import { api, formatDate, STATE_BADGE, STATE_LABEL, useLoad, vehicleName } from "../../lib/api";
import type { FleetState } from "../../types/domain";

export default function FleetPage() {
  const { t } = useTranslation();
  const { data: fleet, error } = useLoad(api.fleet);
  const [filter, setFilter] = useState<FleetState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (error) return <div className="notice warning-notice"><AlertTriangle/><div><b>Нет связи с backend</b><p>{error}</p></div></div>;
  if (!fleet) return <p className="muted"><Loader2 size={14} className="spin"/> Загружаем автопарк…</p>;

  const count = (s: FleetState) => fleet.filter(v => v.state === s).length;
  const rows = filter ? fleet.filter(v => v.state === filter) : fleet;
  const current = fleet.find(v => v.vehicle_id === selectedId) ?? rows[0];
  const pick = (s: FleetState) => () => { setFilter(filter === s ? null : s); setSelectedId(null); };

  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">УПРАВЛЕНИЕ ПАРКОМ</p><h1>Состояние автопарка</h1><p className="muted">По последней проверке каждой машины. Сначала — самые рискованные.</p></div></div>
    <div className="metrics-grid">
      <button className="metric-button" onClick={() => { setFilter(null); setSelectedId(null); }}><MetricCard label="Всего машин" value={String(fleet.length)} hint="Показать все" icon={<Truck size={18}/>}/></button>
      <button className={`metric-button ${filter === "normal" ? "active" : ""}`} onClick={pick("normal")}><MetricCard label={t("ready")} value={String(count("normal"))} hint="Норма" icon={<CheckCircle2 size={18}/>}/></button>
      <button className={`metric-button ${filter === "attention" ? "active" : ""}`} onClick={pick("attention")}><MetricCard label={t("attention")} value={String(count("attention"))} hint="ТО под наблюдением или повтор проверки" icon={<AlertTriangle size={18}/>}/></button>
      <button className={`metric-button ${filter === "quarantine" ? "active" : ""}`} onClick={pick("quarantine")}><MetricCard label={t("quarantine")} value={String(count("quarantine"))} hint="Дефектовка до выпуска в рейс" icon={<ShieldAlert size={18}/>}/></button>
    </div>
    <div className="fleet-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>Приоритетный список</h2><p className="muted">{filter ? `Фильтр: ${STATE_LABEL[filter]}` : "Все машины"} · {rows.length}</p></div></div>
        <div className="vehicle-list">{rows.map(v => {
          const last = v.sessions[v.sessions.length - 1];
          return <button className={`vehicle-row ${current?.vehicle_id === v.vehicle_id ? "selected" : ""}`} key={v.vehicle_id} onClick={() => setSelectedId(v.vehicle_id)}>
            <div className="vehicle-icon"><Truck size={18}/></div>
            <div className="vehicle-row-main"><b>{v.vehicle_id} · {v.garage_no}</b><small>{vehicleName(v)} · {v.engine_model} · {last.anomaly_title ?? t(last.status)}</small></div>
            <span className={`badge ${STATE_BADGE[v.state]}`}>{STATE_LABEL[v.state]}</span>
          </button>;
        })}</div>
      </section>
      {current && <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">ИСТОРИЯ ПРОВЕРОК</p><h2>{current.vehicle_id} · {vehicleName(current)}</h2><p className="muted">{current.engine_model} · {current.reason}</p></div><span className={`badge ${STATE_BADGE[current.state]}`}>{STATE_LABEL[current.state]}</span></div>
        <ScoreChart sessions={current.sessions}/>
        <div className="trend-note"><AlertTriangle size={16}/> {trend(current.sessions)}</div>
        <table className="history-table"><tbody>{[...current.sessions].reverse().map(s => <tr key={s.session_id}>
          <td>{formatDate(s.checked_at)}</td><td>{s.session_id}</td>
          <td>{s.anomaly_type ? `${s.anomaly_type} ${s.anomaly_title}` : t(s.status)}</td>
          <td>{s.anomaly_score ?? "—"}</td>
        </tr>)}</tbody></table>
        <Link className="button button-primary" to={`/?vehicle=${current.vehicle_id}`}>Открыть в рабочем месте<ArrowRight size={16}/></Link>
      </section>}
    </div>
  </div>;
}
