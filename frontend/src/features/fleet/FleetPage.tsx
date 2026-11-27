import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, BookOpen, Bus, Car, Loader2, Search, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, STATE_BADGE, useLoad, vehicleName } from "../../lib/api";
import type { FleetState, FleetVehicle } from "../../types/domain";
import VehicleCard from "../../components/ui/VehicleCard";
import { getVehiclePhoto } from "../../lib/vehiclePhotos";

const modelKey = (v: FleetVehicle) => [v.make, v.model, v.engine_model, v.fuel].join("|");
const typeIcon = (type: string) => /автобус/i.test(type) ? <Bus size={64}/> : /4×4|легков/i.test(type) ? <Car size={64}/> : <Truck size={64}/>;

/** Автопарк = catalog: the fleet by model (photo or pictogram) → that model's vehicles. A vehicle opens in Работа. */
export default function FleetPage() {
  const { t } = useTranslation();
  const { data: fleet, error } = useLoad(api.fleet);
  const [query, setQuery] = useState("");
  const [model, setModel] = useState<string | null>(null);
  if (error) return <div className="notice warning-notice"><AlertTriangle/><div><b>{t("noBackend", "Нет связи с сервером")}</b><p>{error}</p></div></div>;
  if (!fleet) return <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("loadingFleet", "Загружаем автопарк…")}</p>;

  const stateLabel = { quarantine: t("state.quarantine", "Карантин"), attention: t("state.attention", "Внимание"), normal: t("state.normal", "Норма") };
  const count = (s: FleetState) => fleet.filter(v => v.state === s).length;
  const q = query.trim().toLowerCase();
  const list = q ? fleet.filter(v => [v.vehicle_id, v.garage_no, vehicleName(v), v.engine_model].join(" ").toLowerCase().includes(q))
    : model ? fleet.filter(v => modelKey(v) === model) : null;
  const models = Object.values(fleet.reduce<Record<string, FleetVehicle[]>>((acc, v) => { (acc[modelKey(v)] ??= []).push(v); return acc; }, {}));

  return <div className="catalog">
    <h1 className="wizard-title">{t("nav.fleet", "Автопарк")}</h1>
    <div className="fleet-counts">
      <span><Truck size={18}/>{t("catalog.total", "Всего: {{n}}", { n: fleet.length })}</span>
      {(["quarantine", "attention", "normal"] as const).map(s => <span key={s} className={`badge ${STATE_BADGE[s]}`}>{stateLabel[s]}: {count(s)}</span>)}
    </div>
    <label className="wizard-search"><Search size={22}/>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("wizard.search", "Госномер, гаражный номер, модель")}/></label>

    {list ? <>
      {model && !q && <button className="button button-light picker-back" onClick={() => setModel(null)}>
        <ArrowLeft size={22}/>{t("catalog.allModels", "Все модели")}</button>}
      {!list.length && <p className="muted">{t("catalog.none", "Ничего не найдено")}</p>}
      <div className="pick-grid">{list.map(v => <div key={v.vehicle_id} className="pick-item">
        <Link className="pick-vehicle" to={`/?vehicle=${v.vehicle_id}&step=result`}>
          <VehicleCard vehicle={v} labels={{ engine: t("engine", "Двигатель"), garageNo: t("garageNo", "Гаражный №"), noPhoto: t("noPhoto", "Нет фото") }}/>
          <span className={`badge ${STATE_BADGE[v.state]}`}>{stateLabel[v.state]}</span>
        </Link>
        <Link className="button button-light pick-book" to={`/book/${v.vehicle_id}`}><BookOpen size={20}/>{t("book.title", "Сервисная книжка")}</Link>
      </div>)}</div>
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
  </div>;
}
