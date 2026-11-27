import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ClipboardList, Loader2, MessageCircle, RefreshCw, Search, Stethoscope, Truck, Volume2, VolumeX, Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, formatDate, STATE_BADGE, useLoad, vehicleName } from "../../lib/api";
import type { FleetVehicle } from "../../types/domain";
import { PageViewer, type PageRef } from "../../components/ui/SourceCards";
import { LiveProgress } from "../../components/ui/AgentProgress";
import { useCheckSession } from "../session/useCheckSession";
import ResultCard, { verdictLine } from "../session/ResultCard";
import TicketCard from "../session/TicketCard";
import { usePlan } from "../plan/usePlan";
import { PlanStatus, PrepList, StepCard } from "../plan/PlanPanel";
import ChatPanel, { speakable } from "../chat/ChatPanel";
import { parseCommand, useVoice } from "../voice/useVoice";
import VoiceBar from "../voice/VoiceBar";

type Screen = "vehicle" | "result" | "work" | "ticket";
const SCREENS: Screen[] = ["vehicle", "result", "work", "ticket"];

/** Mechanic's main screen: one big step at a time, usable by voice and with gloves. */
export default function WizardPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: fleet } = useLoad(api.fleet);
  const vehicle = fleet?.find(v => v.vehicle_id === params.get("vehicle"));
  const screen: Screen = (params.get("step") as Screen) ?? (vehicle ? "result" : "vehicle");
  const go = (next: Screen, vehicleId = vehicle?.vehicle_id) =>
    setParams(vehicleId && next !== "vehicle" ? { vehicle: vehicleId, step: next } : { step: next });
  const s = useCheckSession(vehicle);
  const plan = usePlan(s.workId);
  const [viewer, setViewer] = useState<PageRef | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [heard, setHeard] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const voice = useVoice(s.lang, text => void onVoice(text));
  const speakOn = autoSpeak || voice.handsFree;
  const steps = plan.plan?.steps ?? [];
  const step = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];

  // Entering the result screen fetches the verdict once.
  const fetched = useRef("");
  useEffect(() => {
    if (screen === "result" && vehicle && s.sessionId && fetched.current !== vehicle.vehicle_id + s.sessionId) {
      fetched.current = vehicle.vehicle_id + s.sessionId;
      setStepIndex(0);
      void s.runDiagnosis().then(r => { if (r && speakOn) void voice.speak(verdictLine(t, r)); });
    }
  }, [screen, vehicle, s.sessionId]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Read the current step aloud when it changes (voice mode).
  useEffect(() => { if (screen === "work" && step && speakOn) void voice.speak(step.text); }, [screen, step?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (fleet ?? []).filter(v => !q || [v.vehicle_id, v.garage_no, vehicleName(v), v.engine_model].join(" ").toLowerCase().includes(q));
  }, [fleet, query]);

  async function onVoice(text: string) {
    setHeard(text);
    const cmd = parseCommand(text);
    if (cmd?.type === "stop") { voice.stopSpeaking(); return; }
    if (cmd?.type === "number" && screen === "vehicle") {
      const match = (fleet ?? []).find(v => v.vehicle_id.includes(cmd.value) || v.garage_no.includes(cmd.value));
      if (match) go("result", match.vehicle_id);
      return;
    }
    if (cmd?.type === "number" && screen === "work" && step?.measure) {
      plan.setStep(step.id, { value: cmd.value, done: cmd.done || plan.stepState(step.id).done });
      return;
    }
    if (cmd?.type === "done" && screen === "work" && step) {
      plan.setStep(step.id, { done: true });
      setStepIndex(i => Math.min(i + 1, steps.length - 1));
      return;
    }
    if (cmd?.type === "next") { screen === "work" && stepIndex < steps.length - 1 ? setStepIndex(i => i + 1) : nextScreen(); return; }
    if (cmd?.type === "back") { screen === "work" && stepIndex > 0 ? setStepIndex(i => i - 1) : prevScreen(); return; }
    if (cmd?.type === "repeat") { void voice.speak(screen === "work" && step ? step.text : s.result ? verdictLine(t, s.result) : ""); return; }
    if (cmd?.type === "result" && vehicle) { fetched.current = ""; go("result"); return; }
    if (cmd?.type === "ticket" || cmd?.type === "confirm") {
      go("ticket");
      if (s.result && !s.ticket && (s.result.block_code === null || (cmd.type === "confirm" && s.result.block_code === "needs_confirmation"))) {
        const answer = await s.createTicket(cmd.type === "confirm");
        if (speakOn && answer) void voice.speak(speakable(answer));
      } else if (s.result?.block_code === "needs_confirmation" && speakOn) {
        void voice.speak(t("voice.sayConfirm", "Запись с помехами. Чтобы создать заявку, скажите «подтверждаю»."));
      }
      return;
    }
    // Anything else is a question for the agent; the answer's first paragraph is read aloud.
    setChatOpen(true);
    const answer = await s.send(text);
    if (answer && speakOn) void voice.speak(speakable(answer));
  }

  const idx = SCREENS.indexOf(screen);
  const nextScreen = () => idx < SCREENS.length - 1 && vehicle && go(SCREENS[idx + 1]);
  const prevScreen = () => idx > 0 && go(SCREENS[idx - 1]);
  const labels = { vehicle: t("wizard.vehicle", "Машина"), result: t("wizard.result", "Результат"),
    work: t("wizard.work", "Работа"), ticket: t("wizard.ticket", "Заявка") };
  const icons = { vehicle: <Truck size={22}/>, result: <Stethoscope size={22}/>, work: <Wrench size={22}/>, ticket: <ClipboardList size={22}/> };

  return <div className="wizard">
    <nav className="wizard-steps" aria-label={t("wizard.progress", "Этапы")}>
      {SCREENS.map((sc, i) => <button key={sc} className={`wizard-step ${sc === screen ? "current" : i < idx ? "passed" : ""}`}
        disabled={sc !== "vehicle" && !vehicle} onClick={() => go(sc)}>
        <span className="wizard-step-icon">{icons[sc]}</span><span>{i + 1}. {labels[sc]}</span>
      </button>)}
    </nav>

    {vehicle && screen !== "vehicle" && <div className="wizard-vehicle">
      <Truck size={18}/><b>{vehicle.vehicle_id}</b><span>{vehicleName(vehicle)} · {vehicle.engine_model}</span>
      <button className="wizard-speak" onClick={() => setAutoSpeak(a => !a)} aria-pressed={speakOn}>
        {speakOn ? <Volume2 size={20}/> : <VolumeX size={20}/>}<span>{speakOn ? t("wizard.speakOn", "Озвучка вкл") : t("wizard.speakOff", "Озвучка")}</span>
      </button>
    </div>}

    <main className="wizard-body">
      {screen === "vehicle" && <VehiclePicker fleet={fleet} shown={shown} query={query} setQuery={setQuery} onPick={v => go("result", v.vehicle_id)}/>}

      {screen === "result" && vehicle && <>
        <div className="wizard-row">
          <select className="vehicle-select" value={s.sessionId} onChange={e => { s.selectSession(e.target.value); fetched.current = ""; }}>
            {[...vehicle.sessions].reverse().map(x => <option key={x.session_id} value={x.session_id}>{x.session_id} · {formatDate(x.checked_at)}</option>)}
          </select>
          <button className="button button-light" onClick={() => { fetched.current = ""; void s.runDiagnosis(); }} disabled={s.loading}>
            <RefreshCw size={18} className={s.loading ? "spin" : ""}/>{t("wizard.again", "Ещё раз")}</button>
        </div>
        {s.loading && <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("gettingResult", "Получаем результат…")}</p>}
        {s.error && <p className="error-text">{s.error}</p>}
        {s.result && <>
          <p className={`wizard-verdict v-${s.result.status}`}>{verdictLine(t, s.result)}</p>
          <ResultCard result={s.result} busy={s.busy} hasTicket={!!s.ticket} vehicleFuel={vehicle.fuel}
            onTicket={confirm => { go("ticket"); void s.createTicket(confirm); }} big/>
          {s.workId && <button className="button button-primary wizard-next" onClick={() => go("work")}>
            <Wrench size={22}/>{t("wizard.toWork", "Что делать — по шагам")}<ArrowRight size={22}/></button>}
          {!s.workId && <button className="button button-light wizard-next" onClick={() => go("vehicle")}>
            <Truck size={22}/>{t("wizard.otherVehicle", "Другая машина")}</button>}
        </>}
      </>}

      {screen === "work" && vehicle && <>
        {!plan.plan ? <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("plan.starting", "Готовлю рабочий план…")}</p> : <>
          <div className="wizard-row"><h2>{t("plan.title", "Что подготовить и что делать")}</h2><PlanStatus plan={plan.plan}/></div>
          {plan.plan.note && <p className="plan-note">{plan.plan.note}</p>}
          <PrepList p={plan} onOpen={setViewer}/>
          {step ? <>
            <div className="wizard-row"><h2>{t("wizard.stepOf", "Шаг {{n}} из {{total}}", { n: stepIndex + 1, total: steps.length })}</h2>
              <span className="muted">{t("plan.steps", "Шаги")}: {plan.doneCount}/{steps.length}</span></div>
            <ol className="step-cards">
              <StepCard key={step.id} item={step} n={stepIndex + 1} state={plan.stepState(step.id)} big isNew={plan.isNew(step)}
                setStep={patch => { plan.setStep(step.id, patch); if (patch.done && stepIndex < steps.length - 1) setStepIndex(i => i + 1); }}
                onOpen={setViewer}/>
            </ol>
            <div className="wizard-nav">
              <button className="button button-light" disabled={stepIndex === 0} onClick={() => setStepIndex(i => i - 1)}><ArrowLeft size={22}/>{t("wizard.prev", "Назад")}</button>
              {stepIndex < steps.length - 1
                ? <button className="button button-primary" onClick={() => setStepIndex(i => i + 1)}>{t("wizard.next", "Дальше")}<ArrowRight size={22}/></button>
                : <button className="button button-primary" onClick={() => go("ticket")}>{t("wizard.toTicket", "К заявке")}<ArrowRight size={22}/></button>}
            </div>
          </> : plan.plan.status === "building" && <div className="plan-live"><p className="muted">{t("wizard.stepsSoon", "Шаги появятся здесь, как только найду их в руководстве.")}</p><LiveProgress events={plan.events.slice(-4)}/></div>}
        </>}
      </>}

      {screen === "ticket" && vehicle && <>
        {s.ticket ? <TicketCard ticket={s.ticket}/> : s.result
          ? <ResultCard result={s.result} busy={s.busy} hasTicket={false} vehicleFuel={vehicle.fuel} onTicket={confirm => void s.createTicket(confirm)} big/>
          : <button className="button button-primary wizard-next" onClick={() => go("result")}>{t("getResult", "Получить результат диагностики")}</button>}
        {s.busy && <div className="plan-live"><LiveProgress events={s.live}/></div>}
        <button className="button button-light wizard-next" onClick={() => go("vehicle")}><Truck size={22}/>{t("wizard.otherVehicle", "Другая машина")}</button>
      </>}
    </main>

    <div className="wizard-dock">
      <VoiceBar voice={voice} heard={heard}/>
      {vehicle && <button className="wizard-chat" onClick={() => setChatOpen(true)}><MessageCircle size={24}/><span>{t("wizard.ask", "Спросить ИИ")}</span>
        {s.busy && <Loader2 size={14} className="spin"/>}</button>}
    </div>

    {chatOpen && vehicle && <div className="chat-sheet" role="dialog" aria-modal="true">
      <button className="viewer-close chat-sheet-close" onClick={() => setChatOpen(false)} aria-label={t("close", "Закрыть")}><X size={26}/></button>
      <ChatPanel s={s} engine={vehicle.engine_model} onOpen={setViewer} onSpeak={text => void voice.speak(text)}/>
    </div>}
    {viewer && <PageViewer page={viewer} onClose={() => setViewer(null)}/>}
  </div>;
}

function VehiclePicker({ fleet, shown, query, setQuery, onPick }: {
  fleet: FleetVehicle[] | null; shown: FleetVehicle[]; query: string; setQuery: (q: string) => void; onPick: (v: FleetVehicle) => void;
}) {
  const { t } = useTranslation();
  if (!fleet) return <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("loadingFleet", "Загружаем автопарк…")}</p>;
  const stateLabel = { quarantine: t("state.quarantine", "Карантин"), attention: t("state.attention", "Внимание"), normal: t("state.normal", "Норма") };
  return <>
    <h1 className="wizard-title">{t("wizard.pickVehicle", "Выберите машину")}</h1>
    <p className="muted">{t("wizard.pickHint", "Нажмите на машину или скажите цифры госномера.")}</p>
    <label className="wizard-search"><Search size={22}/>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("wizard.search", "Госномер, гаражный номер, модель")}/></label>
    <div className="vehicle-grid">{shown.map(v => <button key={v.vehicle_id} className="vehicle-card" onClick={() => onPick(v)}>
      <span className="plate">{v.vehicle_id}</span>
      <span className="vehicle-card-model">{vehicleName(v)} · {v.garage_no}</span>
      <span className="vehicle-card-engine">{v.engine_model}</span>
      <span className={`badge ${STATE_BADGE[v.state]}`}>{stateLabel[v.state]}</span>
    </button>)}</div>
  </>;
}
