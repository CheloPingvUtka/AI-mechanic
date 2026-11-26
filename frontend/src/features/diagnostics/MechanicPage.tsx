import { useState } from "react";
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ClipboardPlus, Mic, RefreshCw, Send, ShieldAlert, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { mockRepairPlan, vehicles } from "../../data/mock";
import { getDiagnosis } from "../../lib/api/diagnostics";
import { askAssistant } from "../../lib/api/assistant";
import type { ChatMessage, DiagnosisResult } from "../../types/domain";
import StatusBadge from "../../components/ui/StatusBadge";

export default function MechanicPage() {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState(vehicles[0].vehicle_id);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const vehicle = vehicles.find(v => v.vehicle_id === vehicleId)!;

  async function runDiagnosis() {
    setLoading(true); setError("");
    try { setResult(await getDiagnosis(vehicleId, `S-${Date.now().toString().slice(-5)}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось получить результат"); }
    finally { setLoading(false); }
  }
  async function sendQuestion() {
    if (!question.trim()) return;
    const q = question.trim(); setQuestion("");
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "user", text: q }]);
    try { const answer = await askAssistant(q, vehicleId); setMessages(prev => [...prev, answer]); }
    catch { setMessages(prev => [...prev, { id: crypto.randomUUID(), role: "assistant", text: "Не удалось получить ответ. Проверьте подключение агента." }]); }
  }

  return <div className="page-grid mechanic-grid">
    <section className="main-column">
      <div className="page-heading"><div><p className="eyebrow">РАБОЧАЯ ЗОНА</p><h1>{t("workspace")}</h1><p className="muted">Проверка двигателя и дальнейшие действия по ремонту</p></div><span className="session-label">Сессия не запущена</span></div>
      <section className="panel vehicle-panel">
        <div className="panel-heading"><div><p className="eyebrow">{t("selectedVehicle")}</p><h2>{vehicle.plate}</h2></div><span className="badge info">ТС выбрано</span></div>
        <select className="vehicle-select" value={vehicleId} onChange={e => { setVehicleId(e.target.value); setResult(null); }} aria-label="Выбрать транспортное средство">
          {vehicles.map(v => <option key={v.vehicle_id} value={v.vehicle_id}>{v.plate} · {v.brand} {v.model} · {v.engine}</option>)}
        </select>
        <div className="vehicle-meta"><span>{vehicle.brand} {vehicle.model}</span><span>Двигатель: <b>{vehicle.engine}</b></span><span>Пробег: {vehicle.mileage_km.toLocaleString("ru-RU")} км</span><span>{vehicle.year} г.</span></div>
        <button className="button button-primary button-large" onClick={runDiagnosis} disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""}/>{loading ? "Получаем результат…" : t("getResult")}<ArrowRight size={17}/></button>
        {error && <p className="error-text">{error}</p>}
      </section>

      {result && <section className="panel result-panel">
        <div className="panel-heading"><div><p className="eyebrow">РЕЗУЛЬТАТ ПРОВЕРКИ · {result.session_id}</p><h2>Заключение по двигателю</h2></div><StatusBadge status={result.status}/></div>
        {result.status === "check_failed" ? <div className="notice warning-notice"><AlertTriangle/><div><b>Проверка не состоялась</b><p>Качество записи недостаточное. Система не делает выводов о состоянии двигателя. Повторите запись на стенде.</p></div></div>
        : result.status === "normal" ? <div className="notice success-notice"><CheckCircle2/><div><b>Значимых отклонений не обнаружено</b><p>По результату этой проверки двигатель не показал признаков отклонения. Продолжайте эксплуатацию согласно регламенту.</p></div></div>
        : <>
          <div className="anomaly-title"><div><span className="eyebrow">ВЕРОЯТНОЕ НАПРАВЛЕНИЕ ПРОВЕРКИ</span><h2>{result.anomaly_title}</h2><p>{result.description}</p></div><div className="confidence"><strong>{Math.round((result.confidence ?? 0) * 100)}%</strong><small>уверенность</small></div></div>
          <div className="notice danger-notice"><ShieldAlert/><div><b>Требуется внимание</b><p>{mockRepairPlan.risk}</p></div></div>
          {result.confidence !== null && result.confidence < 0.7 && <div className="notice warning-notice"><AlertTriangle/><div><b>Низкая уверенность модели</b><p>Результат является предварительной гипотезой. Необходимо подтвердить возможную проблему проверками.</p></div></div>}
          <div className="repair-plan"><h3>План дальнейших действий</h3><ol>{mockRepairPlan.operations.map(item => <li key={item}>{item}</li>)}</ol><p className="demo-source"><BookOpen size={14}/> {mockRepairPlan.references[0].manual} · PDF, стр. {mockRepairPlan.references[0].pdf_page}</p><p className="disclaimer">{mockRepairPlan.confidence_note}</p></div>
          <a className="button button-primary" href="/tickets"><ClipboardPlus size={17}/>{t("createTicket")}<ArrowRight size={16}/></a>
        </>}
      </section>}
    </section>

    <aside className="assistant-panel panel">
      <div className="assistant-heading"><div className="assistant-avatar"><WrenchIcon/></div><div><h2>{t("assistant")}</h2><small>Ответы с опорой на руководство</small></div><span className="online-dot"/></div>
      <div className="chat-messages">
        <div className="chat-bubble assistant-bubble">Здравствуйте! Выберите автомобиль и получите результат проверки. Я помогу разобраться с дальнейшими действиями.</div>
        {messages.map(m => <div key={m.id} className={`chat-bubble ${m.role === "user" ? "user-bubble" : "assistant-bubble"}`}>{m.text}</div>)}
      </div>
      <div className="quick-questions"><span className="eyebrow">БЫСТРЫЕ ВОПРОСЫ</span>{["Чем опасна эта неисправность?","Что проверить в первую очередь?","Можно ли перегнать автомобиль?"].map(q => <button key={q} onClick={() => setQuestion(q)}>{q}</button>)}</div>
      <form className="chat-composer" onSubmit={e => { e.preventDefault(); void sendQuestion(); }}><input value={question} onChange={e => setQuestion(e.target.value)} placeholder={t("ask")}/><button type="button" className="icon-button" title="Голосовой ввод пока не подключён"><Mic size={19}/></button><button className="send-button" type="submit" aria-label="Отправить"><Send size={17}/></button></form>
      <p className="chat-footnote"><Volume2 size={13}/> Голосовой ввод и озвучивание ответа — точка расширения</p>
    </aside>
  </div>;
}

function WrenchIcon() { return <span className="wrench-glyph">✳</span>; }