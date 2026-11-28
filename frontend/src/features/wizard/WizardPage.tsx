import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, CalendarClock, Check, CheckCircle2, Circle, ClipboardCheck, ClipboardList, ClipboardPlus, ListChecks, Loader2, MessageCircle, RefreshCw, Lightbulb, Scale, ShieldCheck, Stethoscope, Truck, Volume2, VolumeX, Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, formatDate, useLoad, vehicleName } from "../../lib/api";
import type { Dispute, Session, Stage } from "../../types/domain";
import { PageViewer, type PageRef } from "../../components/ui/SourceCards";
import Conflicts, { concerns } from "../../components/ui/Conflicts";
import VehiclePicker from "./VehiclePicker";
import { LiveProgress } from "../../components/ui/AgentProgress";
import { useCheckSession } from "../session/useCheckSession";
import ResultCard, { faultTitle, verdictLine } from "../session/ResultCard";
import ScoreChart, { trend } from "../../components/ui/ScoreChart";
import VehicleCard from "../../components/ui/VehicleCard";
import TicketCard from "../session/TicketCard";
import { inNorm, usePlan, type PlanState } from "../plan/usePlan";
import { CheckList, preload, prepSections, StepCard, stepPicture } from "../plan/PlanPanel";
import ChatPanel, { speakable } from "../chat/ChatPanel";
import { parseCommand, useVoice } from "../voice/useVoice";
import { MicButton, VoiceLine } from "../voice/VoiceBar";

type Screen = "vehicle" | "result" | "work" | "ticket";
const SCREENS: Screen[] = ["vehicle", "result", "work", "ticket"];
const WIDE = "(min-width: 1200px)";  // from here the chat is a column next to the work, not a sheet

function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const m = matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Mechanic's main screen: one big step at a time, usable by voice and with gloves. */
export default function WizardPage({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: fleet } = useLoad(api.fleet);
  const vehicle = fleet?.find(v => v.vehicle_id === params.get("vehicle"));
  const screen: Screen = (params.get("step") as Screen) ?? (vehicle ? "result" : "vehicle");
  const workParam = params.get("work");  // a saved repair to resume
  // opened from the disputes journal: the check to select, the chat to open, the conflict to show
  const sessionParam = params.get("session"), chatParam = params.get("chat"), disputeParam = params.get("dispute");
  const s = useCheckSession(vehicle);
  // The open repair stays in the address, so a reload or a resume card comes back to it.
  const go = (next: Screen, vehicleId = vehicle?.vehicle_id) =>
    setParams(!vehicleId || next === "vehicle" ? { step: next }
      : s.workId && vehicleId === vehicle?.vehicle_id ? { vehicle: vehicleId, step: next, work: s.workId } : { vehicle: vehicleId, step: next });
  const plan = usePlan(s.workId);
  const phase = plan.stage, setPhase = plan.setStage;
  const [viewer, setViewer] = useState<PageRef | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [heard, setHeard] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const voice = useVoice(s.lang, text => void onVoice(text));
  const speakOn = autoSpeak || voice.handsFree;
  const chatCol = useWide() && !!vehicle && screen !== "vehicle";
  const openChat = () => { if (!chatCol) setChatOpen(true); };
  const steps = plan.plan?.steps ?? [];
  const at = Math.min(stepIndex, Math.max(steps.length - 1, 0));
  const step = phase === "work" ? steps[at] : undefined;
  const lastStep = at >= steps.length - 1;
  const aftercare = plan.plan?.aftercare ?? [];

  // Resuming a saved repair: its check and chat come back, no new plan is built.
  useEffect(() => {
    if (vehicle && workParam && workParam !== s.workId) void s.resume(workParam);
  }, [vehicle?.vehicle_id, workParam]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (vehicle && !workParam && sessionParam && vehicle.sessions.some(x => x.session_id === sessionParam)) s.selectSession(sessionParam);
  }, [vehicle?.vehicle_id, sessionParam]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (chatParam && vehicle) setChatOpen(true); }, [chatParam, vehicle?.vehicle_id]);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  useEffect(() => {
    setDispute(null);
    if (disputeParam) void api.disputes().then(list => setDispute(list.find(d => String(d.id) === disputeParam) ?? null)).catch(() => {});
  }, [disputeParam]);
  const focusNote = dispute?.kind === "contradiction" ? dispute.detail : null;
  // a conflict found in a chat answer (not in the plan) is shown in the chat
  useEffect(() => {
    if (focusNote && plan.loaded && plan.plan && !plan.plan.conflicts?.some(c => c.note === focusNote)) setChatOpen(true);
  }, [focusNote, plan.loaded, !!plan.plan]);  // eslint-disable-line react-hooks/exhaustive-deps
  // The check result comes when the mechanic asks for it (after the recording on the stand), never by itself.
  const diagnose = () => void s.runDiagnosis().then(r => { if (r && speakOn) void voice.speak(verdictLine(t, r)); });
  // Open the first step not done yet (a resumed repair continues where it stopped).
  useEffect(() => {
    const i = steps.findIndex(x => !plan.stepState(x.id).done);
    setStepIndex(Math.max(i, 0));
  }, [s.workId, steps.length > 0]);  // eslint-disable-line react-hooks/exhaustive-deps
  // The agent knows where the mechanic is in the work ("explain step 3").
  s.context.current = screen === "work" && plan.plan ? { stage: phase, step_index: step ? at + 1 : null, step_text: step?.text ?? "" } : null;
  // Nothing is read aloud unless voice mode or «Озвучка» is on; switching off silences what is playing.
  // (Answers that arrive later check it then, not when the question was asked.)
  useEffect(() => voice.setOutput(speakOn), [speakOn]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Voice mode: "Думаю…" as soon as the agent starts, "Ещё чуть-чуть…" now and then, until the answer.
  useEffect(() => { if (speakOn) void voice.warmUp(); }, [speakOn, s.lang]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => voice.waiting(speakOn && s.busy), [speakOn, s.busy]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Read the current step aloud when it changes (voice mode).
  useEffect(() => { if (screen === "work" && step && speakOn) void voice.speak(step.text); }, [screen, step?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  // "New answer" hint on the chat button while the chat is closed.
  const lastMsg = s.messages[s.messages.length - 1];
  const [seenId, setSeenId] = useState<string>();
  useEffect(() => { if (chatOpen || chatCol) setSeenId(lastMsg?.id); }, [chatOpen, chatCol, lastMsg?.id]);
  const unread = lastMsg?.role === "assistant" && lastMsg.id !== seenId;

  function workNext() {
    if (phase === "prep") { if (steps.length) setPhase("work"); }
    else if (phase === "work") { if (lastStep) setPhase("check"); else setStepIndex(at + 1); }
    else if (phase === "check" && aftercare.length) setPhase("after");
    else go("ticket");
  }
  function workBack() {
    if (phase === "after") setPhase("check");
    else if (phase === "check") setPhase(steps.length ? "work" : "prep");
    else if (phase === "work" && at > 0) setStepIndex(at - 1);
    else if (phase === "work") setPhase("prep");
    else go("result");
  }
  /** «Дальше» on a step: done, or — a measurement step left without its value — skipped (logged, not counted as done). */
  function finishStep() {
    if (!step) return;
    const noValue = !!step.measure && !plan.stepState(step.id).value.trim();
    plan.setStep(step.id, noValue ? { done: false, skipped: true } : { done: true });
    workNext();
  }
  async function ask(text: string) {
    openChat();
    const answer = await s.send(text);
    if (answer && speakOn) void voice.speak(speakable(answer));
  }

  async function onVoice(text: string) {
    setHeard(text);
    const cmd = parseCommand(text);
    if (cmd && cmd.type !== "stop") setChatOpen(false);  // show what the command did
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
    if (cmd?.type === "done" && screen === "work") { if (step) finishStep(); else workNext(); return; }
    if (cmd?.type === "next") { if (screen === "work") workNext(); else nextScreen(); return; }
    if (cmd?.type === "back") { if (screen === "work") workBack(); else prevScreen(); return; }
    if (cmd?.type === "repeat") { void voice.speak(screen === "work" && step ? step.text : s.result ? verdictLine(t, s.result) : ""); return; }
    if (cmd?.type === "result" && vehicle) { go("result"); diagnose(); return; }
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
    await ask(text);
  }

  const idx = SCREENS.indexOf(screen);
  const nextScreen = () => idx < SCREENS.length - 1 && vehicle && go(SCREENS[idx + 1]);
  const prevScreen = () => idx > 0 && go(SCREENS[idx - 1]);
  const labels = { vehicle: t("wizard.vehicle", "Машина"), result: t("wizard.result", "Анамнез"),
    work: t("wizard.work", "Работа"), ticket: t("wizard.ticket", "Заявка") };
  const icons = { vehicle: <Truck size={22}/>, result: <Stethoscope size={22}/>, work: <Wrench size={22}/>, ticket: <ClipboardList size={22}/> };

  // The one primary action of the current state, always in the same place: the action bar.
  type Action = { label: string; onClick?: () => void; wait?: boolean; icon?: ReactNode };
  const toTicket: Action = { label: t("wizard.toTicket", "К заявке"), onClick: () => go("ticket") };
  const otherVehicle: Action = { label: t("wizard.otherVehicle", "Другая машина"), onClick: () => go("vehicle"), icon: <Truck size={22}/> };
  const confirm = s.result?.block_code === "needs_confirmation";
  const ticketAction: Action | null = s.result && !s.ticket && (s.result.block_code === null || confirm) ? { wait: s.busy, icon: <ClipboardPlus size={22}/>,
    label: confirm ? t("result.confirmTicket", "Подтверждаю, создать заявку") : t("result.createTicket", "Создать заявку на дефектовку"),
    onClick: () => void s.createTicket(confirm) } : null;
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const finishWork: Action = { label: t("work.finish", "Завершить ремонт"), icon: <ClipboardCheck size={24}/>, wait: finishing,
    onClick: () => { setFinishing(true); setFinishError(""); plan.finish().catch(e => setFinishError((e as Error).message)).finally(() => setFinishing(false)); } };
  const workPrimary: Action | null = !s.workId ? (s.loading ? null : { label: t("getResult", "Получить результат диагностики"), onClick: () => go("result") })
    : plan.finished ? (ticketAction ? toTicket : otherVehicle)
    : phase === "prep" ? (steps.length ? { label: `${t("work.toSteps", "К шагам")} (${steps.length})`, onClick: workNext }
      : !plan.plan || plan.plan.status === "building" ? { label: t("work.waitSteps", "Шаги собираются…"), wait: true }
      : plan.plan.status === "failed" ? { label: t("work.rebuild", "Собрать заново"), onClick: () => void plan.rebuild(), icon: <RefreshCw size={22}/> }
      : finishWork)
    : phase === "work" ? (step && !plan.stepState(step.id).done
      ? (step.measure && !plan.stepState(step.id).value.trim()
        ? { label: t("work.skipNext", "Без замера — дальше"), onClick: finishStep, icon: <AlertTriangle size={22}/> }
        : { label: lastStep ? t("work.doneLast", "Сделано, к проверке") : t("work.doneNext", "Сделано, дальше"), onClick: finishStep, icon: <Check size={24}/> })
      : { label: lastStep ? t("work.toCheck", "К проверке") : t("wizard.next", "Дальше"), onClick: workNext })
    : phase === "check" && aftercare.length ? { label: t("work.toAfter", "После ремонта"), onClick: workNext }
    : finishWork;
  const getResult: Action = s.loading ? { label: t("gettingResult", "Получаем результат…"), wait: true }
    : { label: t("getResult", "Получить результат диагностики"), onClick: diagnose, icon: <Stethoscope size={22}/> };
  const primary: Action | null = screen === "result" ? (s.result ? (s.workId ? { label: t("wizard.toWork", "Что делать — по шагам"), onClick: () => go("work"), icon: <Wrench size={22}/> } : otherVehicle)
      : getResult)
    : screen === "work" ? workPrimary
    : screen === "ticket" ? (s.ticket ? otherVehicle : !s.result ? { label: t("getResult", "Получить результат диагностики"), onClick: () => go("result") } : ticketAction ?? otherVehicle)
    : null;
  const pickCheck = (id: string) => { s.selectSession(id); if (workParam) setParams({ vehicle: vehicle!.vehicle_id, step: "result" }); };
  const back = screen === "result" ? () => go("vehicle") : screen === "work" ? workBack : screen === "ticket" ? () => go(s.workId ? "work" : "result") : null;

  return <div className={`wizard ${chatCol ? "has-chat" : ""}`} hidden={!active}>
    <div className="wizard-main">
      <nav className="wizard-steps" aria-label={t("wizard.progress", "Этапы")}>
        {SCREENS.map((sc, i) => <button key={sc} className={`wizard-step ${sc === screen ? "current" : i < idx ? "passed" : ""}`}
          disabled={sc !== "vehicle" && !vehicle} onClick={() => go(sc)} aria-current={sc === screen ? "step" : undefined}>
          <span className="wizard-step-icon">{icons[sc]}</span><b>{i + 1}</b><span className="wizard-step-label">{labels[sc]}</span>
        </button>)}
      </nav>

      {vehicle && screen !== "vehicle" && <div className="wizard-vehicle">
        <Truck size={20}/><b>{vehicle.vehicle_id}</b><span className="wizard-vehicle-model">{vehicleName(vehicle)} · {vehicle.engine_model}</span>
        <Link className="wizard-speak" to={`/book/${vehicle.vehicle_id}`} aria-label={t("book.title", "Сервисная книжка")}>
          <BookOpen size={22}/><span>{t("book.short", "Книжка")}</span></Link>
        <button className="wizard-speak" onClick={() => setAutoSpeak(a => !a)} aria-pressed={speakOn}
          aria-label={speakOn ? t("wizard.speakOn", "Озвучка вкл") : t("wizard.speakOff", "Озвучка")}>
          {speakOn ? <Volume2 size={22}/> : <VolumeX size={22}/>}<span>{speakOn ? t("wizard.speakOn", "Озвучка вкл") : t("wizard.speakOff", "Озвучка")}</span>
        </button>
      </div>}

      <main className={`wizard-body screen-${screen}`}>
        {dispute && <DisputeBanner d={dispute} onClose={() => setDispute(null)}/>}
        {screen === "vehicle" && <VehiclePicker fleet={fleet} onPick={v => go("result", v.vehicle_id)}
          onResume={w => setParams({ vehicle: w.vehicle_id, step: "work", work: w.id })}/>}

        {screen === "result" && vehicle && <>
          <VehicleCard className="anamnesis-vehicle" vehicle={vehicle} labels={{ engine: t("engine", "Двигатель"), garageNo: t("garageNo", "Гаражный №") }}/>
          <div className="wizard-row">
            <select className="vehicle-select" value={s.sessionId} onChange={e => pickCheck(e.target.value)}
              aria-label={t("check", "Проверка")}>
              {[...vehicle.sessions].reverse().map(x => <option key={x.session_id} value={x.session_id}>{x.session_id} · {formatDate(x.checked_at)}</option>)}
            </select>
            <button className={`button ${s.result ? "button-light" : "button-primary"}`} onClick={diagnose} disabled={s.loading}>
              {s.result ? <RefreshCw size={18} className={s.loading ? "spin" : ""}/> : <Stethoscope size={18}/>}
              {s.result ? t("wizard.again", "Ещё раз") : t("wizard.getShort", "Получить результат")}</button>
          </div>
          {s.loading && <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("gettingResult", "Получаем результат…")}</p>}
          {s.error && <div className="work-status bad"><AlertTriangle size={28}/><div><b>{s.error}</b></div></div>}
          {s.result && <>
            <p className={`wizard-verdict v-${s.result.status}`}>{verdictLine(t, s.result)}</p>
            <ResultCard result={s.result} busy={s.busy} hasTicket={!!s.ticket} vehicleFuel={vehicle.fuel} history={vehicle.sessions}
              onTicket={confirm => { go("ticket"); void s.createTicket(confirm); }} big/>
          </>}
          <CheckHistory sessions={vehicle.sessions} current={s.sessionId} onPick={pickCheck}/>
        </>}

        {screen === "work" && vehicle && (!s.workId
          ? <div className="work-status warn"><AlertTriangle size={28}/><div><b>{t("work.noWork", "Сначала получите результат проверки.")}</b></div></div>
          : <WorkScreen p={plan} phase={phase} setPhase={setPhase} at={at} setAt={setStepIndex} onOpen={setViewer} busy={s.busy} vehicleId={vehicle.vehicle_id} focus={focusNote}
              onAsk={() => step && void ask(t("chat.explainStep", "Объясни подробнее шаг {{n}}: {{text}}", { n: at + 1, text: step.text.slice(0, 160) }))}/>)}
        {screen === "work" && finishError && <div className="work-status bad"><AlertTriangle size={28}/><div><b>{finishError}</b></div></div>}

        {screen === "ticket" && vehicle && <>
          {s.ticket ? <TicketCard ticket={s.ticket}/> : s.result
            && <ResultCard result={s.result} busy={s.busy} hasTicket={false} vehicleFuel={vehicle.fuel} onTicket={confirm => void s.createTicket(confirm)} big/>}
          {s.busy && <div className="plan-live"><LiveProgress events={s.live} onOpen={setViewer}/></div>}
        </>}
      </main>

      {(!chatCol || primary || back) && <div className="wizard-dock">
        {!chatCol && <div className="dock-chat">
          <MicButton voice={voice}/>
          {vehicle ? <button className={`dock-ask ${unread ? "unread" : ""}`} onClick={openChat}>
              {s.busy ? <Loader2 size={24} className="spin"/> : <MessageCircle size={24}/>}
              <VoiceLine voice={voice} heard={heard}
                title={s.busy ? t("wizard.aiAnswering", "ИИ отвечает…") : unread ? t("wizard.aiNew", "Есть ответ ИИ — открыть") : t("wizard.ask", "Спросить ИИ")}
                hint={t("wizard.askHint", "Скажите или напишите вопрос")}/>
            </button>
            : <VoiceLine voice={voice} heard={heard}/>}
        </div>}
        {(primary || back) && <div className="dock-actions">
          {back && <button className="button button-light dock-back" onClick={back} aria-label={t("wizard.prev", "Назад")}>
            <ArrowLeft size={24}/><span>{t("wizard.prev", "Назад")}</span></button>}
          {primary && <button className="button button-primary dock-primary" disabled={primary.wait} onClick={primary.onClick}>
            {primary.wait ? <Loader2 size={22} className="spin"/> : primary.icon}<span>{primary.label}</span>{!primary.wait && !primary.icon && <ArrowRight size={24}/>}
          </button>}
        </div>}
      </div>}
    </div>

    {chatCol && vehicle && <ChatPanel s={s} engine={vehicle.engine_model} onOpen={setViewer} onSpeak={text => void voice.speak(text, true)} voice={voice} heard={heard} focus={focusNote}/>}
    {chatOpen && !chatCol && vehicle && <div className="chat-sheet" role="dialog" aria-modal="true">
      <ChatPanel s={s} engine={vehicle.engine_model} onOpen={setViewer} onSpeak={text => void voice.speak(text, true)} voice={voice} heard={heard} focus={focusNote}
        onClose={() => setChatOpen(false)}/>
    </div>}
    {viewer && <PageViewer page={viewer} onClose={() => setViewer(null)}/>}
  </div>;
}

/** Work = prepare (tick list) → steps one by one → check (tick list + steps) → after the repair → finish.
 *  Always says what the agent is doing and what to do now. */
function WorkScreen({ p, phase, setPhase, at, setAt, onOpen, onAsk, busy, vehicleId, focus }: {
  p: PlanState; phase: Stage; setPhase: (x: Stage) => void; at: number; setAt: (i: number) => void;
  onOpen: (r: PageRef) => void; onAsk: () => void; busy: boolean; vehicleId: string; focus?: string | null;
}) {
  const { t } = useTranslation();
  const plan = p.plan;
  // a conflict opened from the disputes journal is shown on the preparation stage, where all of them are
  useEffect(() => {
    if (focus && p.loaded && plan?.conflicts?.some(c => c.note === focus)) setPhase("prep");
  }, [focus, p.loaded, !!plan]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the pictures of all steps load while the mechanic is still preparing (the wizard shows big drawings)
  useEffect(() => { preload((plan?.steps ?? []).map(x => stepPicture(x, x.figure != null ? 900 : 360))); }, [plan]);
  if (!plan) return <div className="work-status"><Loader2 size={28} className="spin"/><div><b>{t("plan.starting", "Готовлю рабочий план…")}</b></div></div>;
  const { steps } = plan;
  const step = steps[at];
  const quality = plan.quality ?? [];
  const aftercare = plan.aftercare ?? [];
  const afterList = <CheckList p={p} onOpen={onOpen}
    sections={[{ key: "aftercare", title: t("plan.aftercare", "После ремонта"), icon: <CalendarClock size={18}/>, items: aftercare }]}/>;

  if (p.finished) return <>
    <div className="work-done"><CheckCircle2 size={56}/>
      <b>{t("work.finished", "Ремонт записан в сервисную книжку")}</b>
      <Link className="button button-light" to={`/book/${vehicleId}`}><BookOpen size={22}/>{t("book.open", "Открыть сервисную книжку")}</Link>
    </div>
    {focus && <Conflicts items={plan.conflicts} onOpen={onOpen} focus={focus}/>}
    {afterList}
  </>;

  const prepSecs = prepSections(plan, t);
  const prep = prepSecs.flatMap(x => x.items);
  const ticked = (items: typeof prep) => items.filter(i => p.stepState(i.id).done).length;
  const building = plan.status === "building";
  const count = (items: typeof prep, n = ticked(items)) => items.length ? `${n}/${items.length}` : "";
  const allDone = p.doneCount === steps.length;
  const checked = ticked(quality);
  // [stage, label, icon, count, enabled, complete]: a green tick only when everything in it is marked
  const stages: [Stage, string, ReactNode, string, boolean, boolean][] = [
    ["prep", t("work.stagePrep", "Подготовка"), <ListChecks size={22}/>, count(prep), true, prep.length > 0 && ticked(prep) === prep.length],
    ["work", t("work.stageSteps", "Шаги"), <Wrench size={22}/>, count(steps, p.doneCount), steps.length > 0, steps.length > 0 && allDone],
    ["check", t("work.stageCheck", "Проверка"), <ShieldCheck size={22}/>, count(quality), steps.length > 0 || quality.length > 0,
      quality.length > 0 && checked === quality.length],
    ["after", t("work.stageAfter", "После"), <CalendarClock size={22}/>, "", aftercare.length > 0, false]];
  const current = stages.findIndex(([id]) => id === phase);
  // left behind with something unmarked: a yellow mark instead of the tick (moving on is allowed)
  const skipped = (i: number) => i < current && !stages[i][5] && stages[i][3] !== "";

  return <>
    <nav className="work-stages" aria-label={t("wizard.work", "Работа")}>
      {stages.map(([id, label, icon, n, enabled, complete], i) => <button key={id}
        className={`work-stage ${i === current ? "current" : complete ? "passed" : skipped(i) ? "skipped" : ""}`}
        disabled={!enabled} onClick={() => setPhase(id)} aria-current={i === current ? "step" : undefined}>
        {i !== current && complete ? <CheckCircle2 size={22}/> : skipped(i) ? <AlertTriangle size={22}/> : icon}<span>{label}</span>{n && <small>{n}</small>}
      </button>)}
    </nav>
    {p.saveFailed && <p className="save-failed"><AlertTriangle size={18}/>{t("work.saveFailed", "Не сохранилось. Проверьте связь")}</p>}

    {phase === "prep" && <>
      {steps.length ? <div className="work-status ready"><CheckCircle2 size={28}/><div>
          <b>{t("work.stepsReady", "Шаги готовы: {{n}}", { n: steps.length })}</b>
          <p>{t("work.stepsReadyHint", "Отметьте, что готово, и жмите «К шагам».")}</p>
          {building && <p className="work-status-more"><Loader2 size={16} className="spin"/>{t("work.stillChecking", "Ещё сверяю с руководством.")}</p>}
        </div></div>
      : building ? <div className="work-status"><Loader2 size={28} className="spin"/><div>
          <b>{t("work.building", "Ищу шаги в руководстве…")}</b>
          <p>{t("work.buildingHint", "Пока подготовьте всё по списку.")}</p>
          <LiveProgress events={p.events} onOpen={onOpen}/>
        </div></div>
      : plan.status === "failed" ? <div className="work-status bad"><AlertTriangle size={28}/><div>
          <b>{t("work.failed", "Шаги не собрались")}</b><p>{t("work.failedHint", "Нажмите «Собрать заново».")}</p>
        </div></div>
      : <div className="work-status warn"><AlertTriangle size={28}/><div>
          <b>{t("work.noSteps", "Шаги в руководстве не найдены")}</b><p>{t("work.noStepsHint", "Спросите ИИ или переходите к заявке.")}</p>
        </div></div>}
      <Conflicts items={plan.conflicts} onOpen={onOpen} focus={focus}/>
      {prep.some(i => i.preliminary) && <p className="prep-legend"><span/>{t("work.preliminaryHint", "Пунктир — предварительно, уточняю.")}</p>}
      <CheckList p={p} sections={prepSecs} onOpen={onOpen} checkable/>
    </>}

    {phase === "work" && step && <>
      <div className="work-head">
        <h2>{t("wizard.stepOf", "Шаг {{n}} из {{total}}", { n: at + 1, total: steps.length })}</h2>
        {building && <span className="work-more"><Loader2 size={16} className="spin"/>{t("work.moreSteps", "ищу ещё шаги")}</span>}
      </div>
      <div className="step-progress" aria-hidden="true">{steps.map((x, i) =>
        <span key={x.id} className={i === at ? "current" : p.stepState(x.id).done ? "done" : p.stepState(x.id).skipped ? "skipped" : ""}/>)}</div>
      <ol className="step-cards">
        <StepCard key={step.id} item={step} n={at + 1} state={p.stepState(step.id)} big isNew={p.isNew(step)}
          setStep={patch => p.setStep(step.id, patch)} onOpen={onOpen}/>
      </ol>
      <Conflicts items={plan.conflicts?.filter(c => concerns(c, step))} onOpen={onOpen}/>
      <button className="button button-light work-ask" onClick={onAsk} disabled={busy}>
        <MessageCircle size={22}/>{t("work.askStep", "Спросить про этот шаг")}</button>
    </>}

    {phase === "check" && <>
      {steps.length > 0 && <div className={`work-status ${allDone ? "ready" : "warn"}`}>{allDone ? <CheckCircle2 size={28}/> : <AlertTriangle size={28}/>}<div>
        <b>{t("work.summary", "Сделано {{n}} из {{total}} шагов", { n: p.doneCount, total: steps.length })}</b>
        <p>{allDone ? t("work.summaryAll", "Все шаги сделаны.") : t("work.summaryLeft", "Нажмите на шаг, чтобы доделать.")}</p>
      </div></div>}
      <CheckList p={p} onOpen={onOpen} checkable
        sections={[{ key: "quality", title: t("plan.quality", "Проверьте после ремонта"), icon: <ShieldCheck size={18}/>, items: quality }]}/>
      {steps.length > 0 && <ol className="summary-list">{steps.map((x, i) => {
        const st = p.stepState(x.id);
        const ok = inNorm(x, st.value);
        return <li key={x.id}><button className={st.done ? "done" : st.skipped ? "skipped" : ""} onClick={() => { setAt(i); setPhase("work"); }}>
          {st.done ? <CheckCircle2 size={26}/> : st.skipped ? <AlertTriangle size={26}/> : <Circle size={26}/>}<span><b>{i + 1}.</b> {x.text}</span>
          {st.value && <em className={ok === true ? "ok" : ok === false ? "bad" : ""}>{st.value} {x.measure?.unit}</em>}
          {st.skipped && <em className="skipped">{t("plan.skippedShort", "пропущено")}</em>}
        </button></li>;
      })}</ol>}
    </>}

    {phase === "after" && <>
      {allDone && checked === quality.length
        ? <div className="work-status ready"><CheckCircle2 size={28}/><div>
            <b>{t("work.afterTitle", "Почти готово")}</b><p>{t("work.afterHint", "Запомните, за чем следить, и жмите «Завершить ремонт».")}</p>
          </div></div>
        : <div className="work-status warn"><AlertTriangle size={28}/><div>
            <b>{t("work.afterLeft", "Не всё отмечено: шаги {{n}} из {{total}}, проверка {{q}} из {{qt}}", { n: p.doneCount, total: steps.length, q: checked, qt: quality.length })}</b>
            {p.skippedCount > 0 && <p><b>{t("work.skippedN", "Пропущено замеров: {{n}} — это будет записано в сервисную книжку", { n: p.skippedCount })}</b></p>}
            <p>{t("work.afterLeftHint", "Вернитесь и отметьте, или завершите ремонт так.")}</p>
          </div></div>}
      {afterList}
    </>}
  </>;
}

/** Anamnesis: how this engine sounded check after check; a check opens on tap. */
function CheckHistory({ sessions, current, onPick }: { sessions: Session[]; current: string; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  if (!sessions.length) return null;
  return <section className="panel check-history">
    <h2>{t("anamnesis.title", "Динамика проверок")}</h2>
    {sessions.length > 1 && <><ScoreChart sessions={sessions}/><p className="muted">{trend(sessions, t)}</p></>}
    <ol>{[...sessions].reverse().map(x => <li key={x.session_id}>
      <button className={x.session_id === current ? "current" : ""} onClick={() => onPick(x.session_id)} aria-current={x.session_id === current}>
        <span className={`dot s-${x.status}`}/>
        <span className="ch-date">{formatDate(x.checked_at)}</span>
        <b>{x.status === "anomaly" ? faultTitle(t, x.anomaly_type, x.anomaly_title) : t(x.status)}</b>
        {x.status !== "check_failed" && x.anomaly_score !== null && <em>{Math.round(x.anomaly_score * 100)} %</em>}
      </button></li>)}</ol>
  </section>;
}

/** Opened from the disputes journal: what the dispute is, right on top, so it is clear why this screen is open. */
function DisputeBanner({ d, onClose }: { d: Dispute; onClose: () => void }) {
  const { t } = useTranslation();
  const rec = typeof d.data?.recommendation === "string" ? d.data.recommendation : "";
  return <div className="dispute-banner" role="note">
    <Scale size={26}/>
    <div>
      <b>{t("dispute.bannerTitle", "Спорная ситуация")}: {t(`dispute.${d.kind}`, d.kind)}</b>
      <p>{d.detail}</p>
      {rec && <p className="conflict-rec"><Lightbulb size={18}/><span><b>{t("conflict.recommendation", "Рекомендация ИИ (не из руководства)")}:</b> {rec}</span></p>}
    </div>
    <button onClick={onClose} aria-label={t("close", "Закрыть")}><X size={22}/></button>
  </div>;
}
