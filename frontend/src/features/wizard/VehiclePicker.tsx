import { useState } from "react";
import { ArrowLeft, ArrowRight, Bus, Car, Loader2, Search, Truck, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, STATE_BADGE, useLoad, vehicleName } from "../../lib/api";
import type { FleetVehicle, WorkSummary } from "../../types/domain";
import VehicleCard from "../../components/ui/VehicleCard";
import LicensePlate, { parseVehicleId } from "../../components/ui/LicensePlate";
import { getVehiclePhoto } from "../../lib/vehiclePhotos";
import { faultTitle } from "../session/ResultCard";

const modelKey = (v: FleetVehicle) => [v.make, v.model, v.engine_model, v.fuel].join("|");
const typeIcon = (type: string) => /автобус/i.test(type) ? <Bus size={64}/> : /4×4|легков/i.test(type) ? <Car size={64}/> : <Truck size={64}/>;

/** Wizard screen 1: unfinished repairs to resume, then the fleet by model → that model's vehicles. Search finds any vehicle. */
export default function VehiclePicker({ fleet, onPick, onResume }: {
  fleet: FleetVehicle[] | undefined | null; onPick: (v: FleetVehicle) => void; onResume: (w: WorkSummary) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const { data: works } = useLoad(api.activeWorks);
  if (!fleet) return <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("loadingFleet", "Загружаем автопарк…")}</p>;

  const stateLabel = { quarantine: t("state.quarantine", "Карантин"), attention: t("state.attention", "Внимание"), normal: t("state.normal", "Норма") };
  const q = query.trim().toLowerCase();
  const list = q ? fleet.filter(v => [v.vehicle_id, v.garage_no, vehicleName(v), v.engine_model].join(" ").toLowerCase().includes(q))
    : model ? fleet.filter(v => modelKey(v) === model) : null;
  const models = Object.values(fleet.reduce<Record<string, FleetVehicle[]>>((acc, v) => { (acc[modelKey(v)] ??= []).push(v); return acc; }, {}));

  // one card per check (the newest work; older duplicates come from before works were reused)
  const resumable = works?.filter((w, i, all) => all.findIndex(x => x.vehicle_id === w.vehicle_id && x.session_id === w.session_id) === i);

  return <>
    {!!resumable?.length && !list && <section className="picker-section">
      <h2><Wrench size={24}/>{t("works.title", "Незавершённые работы")}</h2>
      <div className="resume-grid">{resumable.map(w => <button key={w.id} className="resume-card" onClick={() => onResume(w)}>
        {parseVehicleId(w.vehicle_id) ? <LicensePlate vehicleId={w.vehicle_id} width={210}/> : <b>{w.vehicle_id}</b>}
        <b>{faultTitle(t, w.diagnosis?.anomaly_type ?? null, w.diagnosis?.anomaly_title)}</b>
        {w.steps_total > 0 && <>
          <span className="resume-bar"><i style={{ width: `${Math.round(100 * w.steps_done / w.steps_total)}%` }}/></span>
          <span className="resume-count">{t("works.steps", "Шаги: {{done}} из {{total}}", { done: w.steps_done, total: w.steps_total })}</span>
        </>}
        <span className="resume-go">{t("works.continue", "Продолжить")}<ArrowRight size={22}/></span>
      </button>)}</div>
    </section>}

    <h1 className="wizard-title">{t("wizard.pickVehicle", "Выберите машину")}</h1>
    <label className="wizard-search"><Search size={22}/>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("wizard.search", "Госномер, гаражный номер, модель")}/></label>

    {list ? <>
      {model && !q && <button className="button button-light picker-back" onClick={() => setModel(null)}>
        <ArrowLeft size={22}/>{t("catalog.allModels", "Все модели")}</button>}
      <div className="pick-grid">{list.map(v => <button key={v.vehicle_id} className="pick-vehicle" onClick={() => onPick(v)}>
        <VehicleCard vehicle={v} labels={{ engine: t("engine", "Двигатель"), garageNo: t("garageNo", "Гаражный №"), noPhoto: t("noPhoto", "Нет фото") }}/>
        <span className={`badge ${STATE_BADGE[v.state]}`}>{stateLabel[v.state]}</span>
      </button>)}</div>
    </> : <div className="model-grid">{models.map(group => {
      const v = group[0];
      const photo = getVehiclePhoto(v.model, v.make);
      const bad = group.filter(x => x.state === "quarantine").length;
      return <button key={modelKey(v)} className="model-card" onClick={() => setModel(modelKey(v))}>
        <span className="model-pic">{photo ? <img src={photo} alt="" loading="lazy"/> : typeIcon(v.vehicle_type)}</span>
        <b>{v.model ?? v.make}</b>
        <span>{v.engine_model} · {v.fuel}</span>
        <span className="model-count"><em>{t("catalog.count", "Машин: {{n}}", { n: group.length })}</em>
          {bad > 0 && <em className="badge danger">{stateLabel.quarantine}: {bad}</em>}</span>
      </button>;
    })}</div>}
  </>;
}
