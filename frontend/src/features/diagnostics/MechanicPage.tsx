import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, BookOpen, Camera, CheckCircle2, ClipboardCheck, ClipboardPlus, Loader2, RefreshCw, Send, ShieldAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, chatStream, formatDate, shrinkPhoto, URGENCY_LABEL, useLoad, vehicleName } from "../../lib/api";
import type { AgentEvent, Assessment, ChatMessage, Ticket } from "../../types/domain";
import SourceCards, { PageViewer, type PageRef } from "../../components/ui/SourceCards";
import PlanPanel from "../plan/PlanPanel";
import { LiveProgress, ProgressLog } from "../../components/ui/AgentProgress";
import StatusBadge from "../../components/ui/StatusBadge";
import Markdown from "../../components/ui/Markdown";
import ScoreChart, { trend } from "../../components/ui/ScoreChart";

const QUICK = ["Чем опасна эта неисправность?", "Что проверить в первую очередь?", "Можно ли своим ходом перегнать машину на базу?"];

export default function MechanicPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: fleet, error: fleetError } = useLoad(api.fleet);
  const vehicleId = params.get("vehicle") ?? fleet?.[0]?.vehicle_id ?? "";
  const vehicle = fleet?.find(v => v.vehicle_id === vehicleId);
  const [sessionId, setSessionId] = useState("");
  const [result, setResult] = useState<Assessment | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [live, setLive] = useState<AgentEvent[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [viewer, setViewer] = useState<PageRef | null>(null);
  const [workId, setWorkId] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const conversation = useRef<string | null>(null);
  const chatBox = useRef<HTMLDivElement>(null);

  // New vehicle: latest check selected, everything else starts over.
  useEffect(() => {
    setSessionId(vehicle?.sessions[vehicle.sessions.length - 1].session_id ?? "");
    setResult(null); setTicket(null); setMessages([]); setError(""); setWorkId(null);
    conversation.current = null;
  }, [vehicle]);
  // Scroll only the chat box (desktop); never the page, so the verdict stays in view on a phone.
  useEffect(() => { chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, live]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const shrunk = await Promise.all([...files].slice(0, 4).map(f => shrinkPhoto(f)));
    setPhotos(p => [...p, ...shrunk].slice(0, 4));
  }

  async function send(text: string, confirmWarning = false) {
    const images = photos;
    if (!text.trim() && images.length) text = t("photoQuestion");
    if (!vehicle || busy || !text.trim()) return;
    setQuestion(""); setPhotos([]);
    setMessages(m => [...m, { id: crypto.randomUUID(), role: "user", text, images }]);
    setBusy(true); setLive([]);
    const events: AgentEvent[] = [];
    try {
      const reply = await chatStream({
        vehicle_id: vehicle.vehicle_id, session_id: sessionId, message: text,
        conversation_id: conversation.current, confirm_warning: confirmWarning, images,
      }, e => { events.push(e); setLive([...events]); });
      conversation.current = reply.conversation_id;
      if (reply.ticket) setTicket(reply.ticket);
      setMessages(m => [...m, { id: crypto.randomUUID(), role: "assistant", text: reply.answer, sources: reply.sources, cost: reply.cost_usd, events }]);
    } catch (e) {
      setMessages(m => [...m, { id: crypto.randomUUID(), role: "assistant", error: true, text: `Агент не ответил: ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  }

  async function runDiagnosis() {
    if (!vehicle) return;
    setLoading(true); setError(""); setResult(null); setTicket(null); setWorkId(null);
    try {
      const assessment = await api.diagnose(vehicle.vehicle_id, sessionId);
      setResult(assessment);
      if (assessment.status === "anomaly") {
        // The plan builds in the background; chat shares its conversation, so both see the same pages.
        const { work_id } = await api.startWork(vehicle.vehicle_id, sessionId);
        conversation.current = work_id;
        setWorkId(work_id);
      }
      void send(`Объясни результат проверки ${sessionId}`);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  if (fleetError) return <div className="notice warning-notice"><AlertTriangle/><div><b>Нет связи с backend</b><p>{fleetError}</p></div></div>;
  if (!fleet || !vehicle) return <p className="muted"><Loader2 size={14} className="spin"/> Загружаем автопарк…</p>;

  return <div className="page-grid mechanic-grid">
    <section className="main-column">
      <div className="page-heading"><div><p className="eyebrow">РАБОЧАЯ ЗОНА</p><h1>{t("workspace")}</h1><p className="muted">Проверка двигателя и дальнейшие действия по ремонту</p></div></div>

      <section className="panel vehicle-panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("selectedVehicle")}</p><h2>{vehicle.vehicle_id} · {vehicle.garage_no}</h2></div></div>
        <select className="vehicle-select" value={vehicle.vehicle_id} onChange={e => setParams({ vehicle: e.target.value })} aria-label="Транспортное средство">
          {fleet.map(v => <option key={v.vehicle_id} value={v.vehicle_id}>{v.vehicle_id} · {v.garage_no} · {vehicleName(v)} · {v.engine_model}</option>)}
        </select>
        <div className="vehicle-meta"><span>{vehicleName(vehicle)}</span><span>Двигатель: <b>{vehicle.engine_model}</b></span><span>Топливо: {vehicle.fuel}</span><span>{vehicle.vehicle_type}</span></div>
        <select className="vehicle-select" value={sessionId} onChange={e => { setSessionId(e.target.value); setResult(null); setTicket(null); }} aria-label="Проверка">
          {[...vehicle.sessions].reverse().map(s => <option key={s.session_id} value={s.session_id}>{s.session_id} · {formatDate(s.checked_at)} · {t(s.status)}</option>)}
        </select>
        <button className="button button-primary button-large" onClick={() => void runDiagnosis()} disabled={loading}>
          <RefreshCw size={17} className={loading ? "spin" : ""}/>{loading ? "Получаем результат…" : t("getResult")}<ArrowRight size={17}/>
        </button>
        {error && <p className="error-text">{error}</p>}
      </section>

      {result && <ResultCard result={result} busy={busy} ticket={ticket} send={send}/>}
      {workId && <PlanPanel workId={workId} onOpen={setViewer} onReport={text => void send(text)}/>}
      {ticket && <TicketCard ticket={ticket}/>}

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">ИСТОРИЯ ПРОВЕРОК</p><h2>Динамика anomaly_score</h2></div></div>
        <ScoreChart sessions={vehicle.sessions}/>
        <p className="muted">{trend(vehicle.sessions)} Пунктир — 0,5: ниже этого уровня модель не сообщает об отклонении.</p>
      </section>
    </section>

    <aside className="assistant-panel panel">
      <div className="assistant-heading"><div className="assistant-avatar"><span className="wrench-glyph">✳</span></div><div><h2>{t("assistant")}</h2><small>Отвечает только по руководству на {vehicle.engine_model}</small></div><span className="online-dot"/></div>
      <div className="chat-messages" ref={chatBox}>
        <div className="chat-bubble assistant-bubble">Получите результат проверки — я объясню его и найду порядок проверки в руководстве. Нормативы даю только со ссылкой на страницу.</div>
        {messages.map(m => <div key={m.id} className={`chat-bubble ${m.role === "user" ? "user-bubble" : "assistant-bubble"} ${m.error ? "error-bubble" : ""}`}>
          {!!m.images?.length && <div className="bubble-photos">{m.images.map((src, i) => <img key={i} src={src} alt=""/>)}</div>}
          {m.role === "user" ? m.text : <Markdown text={m.text} onCite={(manual, page) => {
            const s = m.sources?.find(x => x.manual === manual && x.pdf_page === page);
            if (s) setViewer(s);
          }}/>}
          {!!m.sources?.length && <SourceCards sources={m.sources} onOpen={setViewer}/>}
          {!!m.events?.length && <ProgressLog events={m.events}/>}
          {m.cost !== undefined && <small className="cost-note">стоимость ответа ${m.cost.toFixed(4)}</small>}
        </div>)}
        {busy && <div className="chat-bubble assistant-bubble"><LiveProgress events={live}/></div>}
      </div>
      <div className="quick-questions"><span className="eyebrow">БЫСТРЫЕ ВОПРОСЫ</span>{QUICK.map(q => <button key={q} disabled={busy} onClick={() => void send(q)}>{q}</button>)}</div>
      {!!photos.length && <div className="photo-tray">{photos.map((src, i) => <div key={i}><img src={src} alt=""/>
        <button aria-label={t("remove")} onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}><X size={14}/></button></div>)}</div>}
      <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(question); }}>
        <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden
          onChange={e => { void addPhotos(e.target.files); e.target.value = ""; }}/>
        <button type="button" className="icon-button camera-button" onClick={() => photoInput.current?.click()} aria-label={t("attachPhoto")}><Camera size={20}/></button>
        <input value={question} onChange={e => setQuestion(e.target.value)} placeholder={t("ask")}/>
        <button className="send-button" type="submit" disabled={busy} aria-label={t("send")}><Send size={17}/></button>
      </form>
    </aside>
    {viewer && <PageViewer page={viewer} onClose={() => setViewer(null)}/>}
  </div>;
}

function ResultCard({ result, busy, ticket, send }: { result: Assessment; busy: boolean; ticket: Ticket | null; send: (text: string, confirm?: boolean) => Promise<void> }) {
  const failed = result.status === "check_failed" || result.signal_quality === "bad";
  const lowConfidence = result.confidence !== null && result.confidence < result.confidence_threshold;
  const otherBlock = result.ticket_blocked_reason && !result.needs_warning_confirmation && !lowConfidence;
  return <section className="panel result-panel">
    <div className="panel-heading"><div><p className="eyebrow">РЕЗУЛЬТАТ ПРОВЕРКИ · {result.session_id}</p><h2>Заключение по двигателю</h2></div><StatusBadge status={result.status}/></div>
    {failed ? <div className="notice warning-notice"><AlertTriangle/><div><b>Проверка не состоялась — повторите запись</b><p>{result.description}. Выводов о состоянии двигателя нет. Проверьте установку стенда и посторонний шум, запишите снова.</p></div></div>
    : result.status === "normal" ? <div className="notice success-notice"><CheckCircle2/><div><b>Значимых отклонений не обнаружено</b><p>Эксплуатация продолжается по регламенту.</p></div></div>
    : <>
      <div className="anomaly-title">
        <div><span className="eyebrow">ПРЕДПОЛАГАЕМАЯ НЕИСПРАВНОСТЬ · {result.anomaly_type}</span><h2>{result.anomaly_title}</h2><p>{result.description}</p></div>
        <div className="confidence"><strong>{Math.round((result.confidence ?? 0) * 100)}%</strong><small>уверенность</small></div>
      </div>
      {result.urgency && !lowConfidence && !otherBlock && <div className={`notice ${result.urgency.level === "high" ? "danger-notice" : "warning-notice"}`}><ShieldAlert/><div><b>Приоритет: {URGENCY_LABEL[result.urgency.level]}</b><p>{result.urgency.meaning}. Это рекомендация, решение принимает механик.</p></div></div>}
      {result.signal_quality === "warning" && <div className="notice warning-notice"><AlertTriangle/><div><b>Запись с помехами</b><p>Уверенность модели снижена. Заявку можно создать только после вашего подтверждения.</p></div></div>}
      {lowConfidence && <div className="notice warning-notice"><AlertTriangle/><div><b>Уверенность ниже порога {result.confidence_threshold.toFixed(2)}</b><p>Результат ненадёжен: нужна повторная проверка. Заявка не создаётся.</p></div></div>}
      {otherBlock && <div className="notice warning-notice"><AlertTriangle/><div><b>Заявка не создаётся</b><p>{result.ticket_blocked_reason}</p></div></div>}
      {!ticket && !result.ticket_blocked_reason && <button className="button button-primary" disabled={busy} onClick={() => void send("Создай заявку на дефектовку")}><ClipboardPlus size={17}/>Создать заявку на дефектовку</button>}
      {!ticket && result.needs_warning_confirmation && <button className="button button-primary" disabled={busy} onClick={() => void send("Создай заявку на дефектовку", true)}><ClipboardCheck size={17}/>Подтверждаю, создать заявку</button>}
    </>}
  </section>;
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  return <section className="panel ticket-card">
    <div className="notice success-notice"><CheckCircle2/><div><b>Заявка {ticket.ticket_id} создана</b><p>Приоритет: {URGENCY_LABEL[ticket.urgency]} · {ticket.anomaly_type} · проверка {ticket.session_id}</p></div></div>
    {ticket.operation_ban && <div className="notice danger-notice"><ShieldAlert/><div><b>Руководство запрещает эксплуатацию</b><p>«{ticket.operation_ban.quote}» — {ticket.operation_ban.manual}, стр. {ticket.operation_ban.pdf_page}</p></div></div>}
    <p>{ticket.conclusion}</p>
    <ol>{ticket.operations.map(o => <li key={o}>{o}</li>)}</ol>
    {!!ticket.spare_parts.length && <p className="muted">Запчасти: {ticket.spare_parts.join(", ")}</p>}
    {ticket.references.map(r => <p key={r.manual + r.pdf_page} className="demo-source"><BookOpen size={14}/> {r.manual} · стр. PDF {r.pdf_page}</p>)}
  </section>;
}
