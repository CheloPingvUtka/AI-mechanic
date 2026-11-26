import { useState } from "react";
import { BookOpen, CheckCircle2, ClipboardList, Send } from "lucide-react";
import { vehicles, mockDiagnosis, mockRepairPlan } from "../../data/mock";
import { createTicket } from "../../lib/api/tickets";
import type { Urgency } from "../../types/domain";

export default function TicketPage() {
  const [urgency, setUrgency] = useState<Urgency>("high");
  const [createdId, setCreatedId] = useState("");
  const [busy, setBusy] = useState(false);
  const vehicle = vehicles[0];
  async function submit() {
    setBusy(true);
    try {
      const result = await createTicket({
        vehicle_id: vehicle.vehicle_id, session_id: mockDiagnosis.session_id,
        anomaly_type: mockDiagnosis.anomaly_type ?? "F08", conclusion: mockRepairPlan.conclusion,
        urgency, operations: mockRepairPlan.operations, spare_parts: mockRepairPlan.spare_parts,
        references: mockRepairPlan.references,
      });
      setCreatedId(result.ticket_id);
    } finally { setBusy(false); }
  }
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">ТОиР</p><h1>Заявка на дефектовку</h1><p className="muted">Проверьте данные, приоритет и перечень работ перед отправкой</p></div></div>
    {createdId && <div className="notice success-notice"><CheckCircle2/><div><b>Заявка создана: {createdId}</b><p>Mock ТОиР подтвердил регистрацию заявки.</p></div></div>}
    <div className="ticket-layout">
      <div className="main-column">
        <section className="panel"><p className="eyebrow">ТРАНСПОРТНОЕ СРЕДСТВО</p><h2>{vehicle.plate} · {vehicle.brand} {vehicle.model}</h2><p className="muted">{vehicle.engine} · Сессия {mockDiagnosis.session_id}</p></section>
        <section className="panel"><p className="eyebrow">ПРЕДПОЛАГАЕМАЯ НЕИСПРАВНОСТЬ</p><h2>F08 · {mockDiagnosis.anomaly_title}</h2><p>{mockRepairPlan.conclusion}</p></section>
        <section className="panel"><p className="eyebrow">РЕКОМЕНДУЕМЫЕ РАБОТЫ</p><ul className="task-list">{mockRepairPlan.operations.map(x => <li key={x}><CheckCircle2 size={17}/>{x}</li>)}</ul><button className="text-button">+ Добавить работу</button></section>
        <section className="panel"><p className="eyebrow">ЗАПЧАСТИ</p><p className="muted">Пока не определены. Уточнить после дефектовки.</p><button className="text-button">+ Добавить запчасть</button></section>
      </div>
      <aside className="main-column">
        <section className="panel"><p className="eyebrow">ПРИОРИТЕТ</p><div className="field-stack"><label><input type="radio" checked={urgency==="high"} onChange={()=>setUrgency("high")}/> Высокий</label><label><input type="radio" checked={urgency==="medium"} onChange={()=>setUrgency("medium")}/> Средний</label><label><input type="radio" checked={urgency==="low"} onChange={()=>setUrgency("low")}/> Низкий</label></div></section>
        <section className="panel"><p className="eyebrow">ИСТОЧНИКИ</p><div className="source-row"><BookOpen size={17}/><div><b>{mockRepairPlan.references[0].manual}</b><small>PDF · Страница {mockRepairPlan.references[0].pdf_page}</small></div></div></section>
        <section className="panel"><h3>Перед отправкой</h3><p className="muted">Заявка будет передана в тестовую систему ТОиР. После успешной отправки появится номер.</p><button className="button button-primary full-width" onClick={() => void submit()} disabled={busy}><Send size={16}/>{busy ? "Отправка…" : "Подтвердить и создать"}</button></section>
      </aside>
    </div>
  </div>;
}