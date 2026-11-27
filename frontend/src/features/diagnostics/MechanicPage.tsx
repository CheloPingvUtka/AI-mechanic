import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, formatDate, useLoad, vehicleName } from "../../lib/api";
import { PageViewer, type PageRef } from "../../components/ui/SourceCards";
import ScoreChart, { trend } from "../../components/ui/ScoreChart";
import { useCheckSession } from "../session/useCheckSession";
import ResultCard from "../session/ResultCard";
import TicketCard from "../session/TicketCard";
import PlanPanel from "../plan/PlanPanel";
import { usePlan } from "../plan/usePlan";
import ChatPanel from "../chat/ChatPanel";
import VehicleCard from "../../components/ui/VehicleCard";

/** Detailed workspace (desktop / chief mechanic): everything on one screen. */
export default function MechanicPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: fleet, error: fleetError } = useLoad(api.fleet);
  const vehicleId = params.get("vehicle") ?? fleet?.[0]?.vehicle_id ?? "";
  const vehicle = fleet?.find(v => v.vehicle_id === vehicleId);
  const s = useCheckSession(vehicle);
  const plan = usePlan(s.workId);
  const [viewer, setViewer] = useState<PageRef | null>(null);

  if (fleetError) return <div className="notice warning-notice"><AlertTriangle/><div><b>{t("noBackend", "Нет связи с сервером")}</b><p>{fleetError}</p></div></div>;
  if (!fleet || !vehicle) return <p className="muted"><Loader2 size={14} className="spin"/> {t("loadingFleet", "Загружаем автопарк…")}</p>;

  return <div className="page-grid mechanic-grid">
    <section className="main-column">
      <div className="page-heading"><div><p className="eyebrow">{t("detail.eyebrow", "РАБОЧАЯ ЗОНА")}</p><h1>{t("detail.title", "Подробно")}</h1>
        <p className="muted">{t("detail.subtitle", "Проверка двигателя и дальнейшие действия по ремонту")}</p></div></div>

      <section className="panel vehicle-panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("selectedVehicle", "Транспортное средство")}</p></div></div>
        <VehicleCard className="selected-vehicle-card" vehicle={vehicle} labels={{ engine: t("engine"), garageNo: t("garageNo") }}/>
        <select className="vehicle-select" value={vehicle.vehicle_id} onChange={e => setParams({ vehicle: e.target.value })} aria-label={t("selectedVehicle", "Транспортное средство")}>
          {fleet.map(v => <option key={v.vehicle_id} value={v.vehicle_id}>{v.vehicle_id} · {v.garage_no} · {vehicleName(v)} · {v.engine_model}</option>)}
        </select>
        <div className="vehicle-meta"><span>{vehicleName(vehicle)}</span><span>{t("engine", "Двигатель")}: <b>{vehicle.engine_model}</b></span>
          <span>{t("fuel.label", "Топливо")}: {vehicle.fuel}</span></div>
        <select className="vehicle-select" value={s.sessionId} onChange={e => s.selectSession(e.target.value)} aria-label={t("check", "Проверка")}>
          {[...vehicle.sessions].reverse().map(x => <option key={x.session_id} value={x.session_id}>{x.session_id} · {formatDate(x.checked_at)} · {t(x.status)}</option>)}
        </select>
        <button className="button button-primary button-large" onClick={() => void s.runDiagnosis()} disabled={s.loading}>
          <RefreshCw size={17} className={s.loading ? "spin" : ""}/>{s.loading ? t("gettingResult", "Получаем результат…") : t("getResult", "Получить результат диагностики")}<ArrowRight size={17}/>
        </button>
        {s.error && <p className="error-text">{s.error}</p>}
      </section>

      {s.result && <ResultCard result={s.result} busy={s.busy} hasTicket={!!s.ticket} vehicleFuel={vehicle.fuel}
        onTicket={confirm => void s.createTicket(confirm)}/>}
      {s.ticket && <TicketCard ticket={s.ticket}/>}
      {s.workId && <PlanPanel p={plan} onOpen={setViewer} onReport={text => void s.send(text)}/>}

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("history.eyebrow", "ИСТОРИЯ ПРОВЕРОК")}</p><h2>{t("history.title", "Динамика anomaly_score")}</h2></div></div>
        <ScoreChart sessions={vehicle.sessions}/>
        <p className="muted">{trend(vehicle.sessions, t)} {t("history.threshold", "Пунктир — 0,5: ниже этого уровня модель не сообщает об отклонении.")}</p>
      </section>
    </section>

    <ChatPanel s={s} engine={vehicle.engine_model} onOpen={setViewer}/>
    {viewer && <PageViewer page={viewer} onClose={() => setViewer(null)}/>}
  </div>;
}
