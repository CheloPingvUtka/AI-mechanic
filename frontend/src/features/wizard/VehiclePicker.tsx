import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Loader2, Search, Truck, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, STATE_BADGE, useLoad, vehicleName } from "../../lib/api";
import type { FleetVehicle, WorkSummary } from "../../types/domain";
import LicensePlate, { parseVehicleId } from "../../components/ui/LicensePlate";
import { faultTitle } from "../session/ResultCard";

const RISK = { quarantine: 0, attention: 1, normal: 2 };

/** Wizard screen 1: repairs in progress, then the vehicles that need attention (riskiest first). Search finds any other one;
 *  the whole fleet by model lives in «Автопарк». */
export default function VehiclePicker({ fleet, onPick, onResume }: {
  fleet: FleetVehicle[] | undefined | null; onPick: (v: FleetVehicle) => void; onResume: (w: WorkSummary) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: works } = useLoad(api.activeWorks);
  if (!fleet) return <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("loadingFleet", "Загружаем автопарк…")}</p>;

  const stateLabel = { quarantine: t("state.quarantine", "Карантин"), attention: t("state.attention", "Внимание"), normal: t("state.normal", "Норма") };
  // one card per check (the newest work; older duplicates come from before works were reused)
  const resumable = (works ?? []).filter((w, i, all) => all.findIndex(x => x.vehicle_id === w.vehicle_id && x.session_id === w.session_id) === i);
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  const found = q ? fleet.filter(v => [v.vehicle_id, v.garage_no, vehicleName(v)].join(" ").toLowerCase().replace(/\s+/g, "").includes(q)) : null;
  // the server's order is already by risk; the stable sort only puts quarantine before attention
  const attention = fleet.filter(v => v.state !== "normal").sort((a, b) => RISK[a.state] - RISK[b.state]);

  const row = (v: FleetVehicle) => {
    const last = v.sessions[v.sessions.length - 1];
    const work = resumable.find(w => w.vehicle_id === v.vehicle_id);
    return <li key={v.vehicle_id}><button className={`attn-row state-${v.state} ${work ? "in-work" : ""}`} onClick={() => work ? onResume(work) : onPick(v)}>
      <span className="attn-plate">{parseVehicleId(v.vehicle_id) ? <LicensePlate vehicleId={v.vehicle_id} width={150}/> : <b>{v.vehicle_id}</b>}</span>
      <span className="attn-text"><b>{last?.anomaly_type ? faultTitle(t, last.anomaly_type, last.anomaly_title) : t(`fleetReason.${v.code}`, v.reason)}</b>
        <small>{vehicleName(v)} · {v.garage_no}</small></span>
      <span className="attn-badges">
        {work && <em className="badge work-badge"><Wrench size={14}/>{t("works.title", "В работе")}</em>}
        <em className={`badge ${STATE_BADGE[v.state]}`}>{stateLabel[v.state]}</em>
      </span>
      <ChevronRight size={26} className="attn-go"/>
    </button></li>;
  };

  return <>
    {!!resumable.length && !found && <section className="picker-section">
      <h2><Wrench size={24}/>{t("works.title", "В работе")}</h2>
      <div className="resume-grid">{resumable.map(w => <button key={w.id} className="resume-card" onClick={() => onResume(w)}>
        {parseVehicleId(w.vehicle_id) ? <LicensePlate vehicleId={w.vehicle_id} width={150}/> : <b>{w.vehicle_id}</b>}
        <b>{faultTitle(t, w.diagnosis?.anomaly_type ?? null, w.diagnosis?.anomaly_title)}</b>
        {w.steps_total > 0 && <>
          <span className="resume-bar"><i style={{ width: `${Math.round(100 * w.steps_done / w.steps_total)}%` }}/></span>
          <span className="resume-count">{t("works.steps", "Шаги: {{done}} из {{total}}", { done: w.steps_done, total: w.steps_total })}</span>
        </>}
        <span className="resume-go">{t("works.continue", "Продолжить")}<ArrowRight size={22}/></span>
      </button>)}</div>
    </section>}

    <label className="wizard-search"><Search size={22}/>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("works.search", "Госномер или гаражный №")}/></label>

    {found ? <section className="picker-section">
      {found.length ? <ul className="attn-list">{found.map(row)}</ul> : <p className="muted">{t("catalog.none", "Ничего не найдено")}</p>}
    </section>
    : <section className="picker-section">
      <h2><AlertTriangle size={24}/>{t("attention", "Требуют внимания")} <span className="picker-count">{attention.length}</span></h2>
      {attention.length ? <ul className="attn-list">{attention.map(row)}</ul>
        : <div className="work-status ready"><CheckCircle2 size={28}/><div><b>{t("works.allOk", "Все машины в норме")}</b></div></div>}
    </section>}

    <Link className="button button-light picker-all" to="/fleet"><Truck size={24}/>{t("catalog.all", "Все машины — Автопарк")}<ArrowRight size={22}/></Link>
  </>;
}
