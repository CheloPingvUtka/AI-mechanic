import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle2, Circle, HardHat, Loader2, Package, Send, Sparkles, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { watchWork } from "../../lib/api";
import type { AgentEvent, PlanItem, WorkPlan } from "../../types/domain";
import { LiveProgress } from "../../components/ui/AgentProgress";
import { thumb, type PageRef } from "../../components/ui/SourceCards";

const NEW_FOR_MS = 20000;

function pageRef(item: PlanItem): PageRef | null {
  return item.manual_id && item.pdf_page
    ? { manual_id: item.manual_id, manual: item.manual ?? "", pdf_page: item.pdf_page, figures: item.figures }
    : null;
}

export type StepState = { done: boolean; value: string };

/** Is a measured value inside the manual's range? null = nothing to judge yet. */
export function inNorm(item: PlanItem, value: string): boolean | null {
  const v = Number(value.replace(",", "."));
  if (!item.measure || !value.trim() || Number.isNaN(v)) return null;
  const { min, max } = item.measure;
  return (min === null || v >= min) && (max === null || v <= max);
}

export function normText(item: PlanItem): string {
  const m = item.measure;
  if (!m) return "";
  const range = m.min !== null && m.max !== null ? (m.min === m.max ? `${m.min}` : `${m.min}–${m.max}`) : m.min !== null ? `≥ ${m.min}` : `≤ ${m.max}`;
  return `${range} ${m.unit}`;
}

/** Live plan for a check: what to prepare, then steps with pictures, norms and measurement inputs. */
export default function PlanPanel({ workId, onOpen, onReport }: {
  workId: string;
  onOpen: (p: PageRef) => void;
  onReport: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [steps, setSteps] = useState<Record<number, StepState>>({});
  const firstSeen = useRef(new Map<number, number>());
  const [, tick] = useState(0);

  useEffect(() => {
    setPlan(null); setEvents([]); setSteps({}); firstSeen.current.clear();
    return watchWork(workId, p => {
      const now = Date.now();
      for (const i of [...p.tools, ...p.materials, ...p.safety, ...p.steps]) {
        if (!firstSeen.current.has(i.id)) firstSeen.current.set(i.id, p.version <= 2 ? 0 : now);
      }
      setPlan(p);
    }, e => setEvents(ev => [...ev, e]));
  }, [workId]);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(id); }, []);

  if (!plan) return <section className="panel plan-panel"><p className="muted"><Loader2 size={14} className="spin"/> {t("plan.starting")}</p></section>;
  const isNew = (i: PlanItem) => Date.now() - (firstSeen.current.get(i.id) ?? 0) < NEW_FOR_MS;
  const set = (id: number, patch: Partial<StepState>) =>
    setSteps(s => ({ ...s, [id]: { ...(s[id] ?? { done: false, value: "" }), ...patch } }));
  const doneCount = plan.steps.filter(s => steps[s.id]?.done).length;

  function report() {
    const lines = plan!.steps.map((s, i) => {
      const st = steps[s.id];
      const value = st?.value ? `, ${s.measure?.name}: ${st.value} ${s.measure?.unit} (${inNorm(s, st.value) ? t("plan.ok") : t("plan.outOfNorm")})` : "";
      return `${i + 1}. ${st?.done ? "✓" : "—"} ${s.text.slice(0, 80)}${value}`;
    });
    onReport(`${t("plan.reportHeader")}\n${lines.join("\n")}`);
  }

  const chips = (items: PlanItem[], icon: ReactNode) => items.map(i => {
    const ref = pageRef(i);
    return <li key={i.id} className={`prep-item ${i.preliminary ? "preliminary" : ""} ${isNew(i) ? "is-new" : ""}`}>
      {icon}<span>{i.text}</span>
      {i.preliminary ? <em>{t("plan.preliminary")}</em> : ref && <button className="cite-chip" onClick={() => onOpen(ref)}>📖 {ref.pdf_page}</button>}
      {isNew(i) && <strong className="new-badge"><Sparkles size={11}/>{t("plan.new")}</strong>}
    </li>;
  });

  return <section className="panel plan-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">{t("plan.eyebrow")}</p><h2>{t("plan.title")}</h2></div>
      <span className={`badge ${plan.status === "ready" ? "success" : plan.status === "failed" ? "danger" : "info"}`}>
        {plan.status === "building" && <Loader2 size={12} className="spin"/>}{t(`plan.status_${plan.status}`)}
      </span>
    </div>
    {plan.status === "building" && <div className="plan-live"><LiveProgress events={events.slice(-4)}/></div>}
    {plan.note && <p className="plan-note">{plan.note}</p>}

    {(plan.tools.length > 0 || plan.materials.length > 0 || plan.safety.length > 0) && <div className="prep-grid">
      {plan.tools.length > 0 && <div><h3><Wrench size={16}/>{t("plan.tools")}</h3><ul>{chips(plan.tools, <Wrench size={14}/>)}</ul></div>}
      {plan.materials.length > 0 && <div><h3><Package size={16}/>{t("plan.materials")}</h3><ul>{chips(plan.materials, <Package size={14}/>)}</ul></div>}
      {plan.safety.length > 0 && <div><h3><HardHat size={16}/>{t("plan.safety")}</h3><ul>{chips(plan.safety, <HardHat size={14}/>)}</ul></div>}
    </div>}

    {plan.steps.length > 0 && <>
      <h3 className="steps-title">{t("plan.steps")} <span>{doneCount}/{plan.steps.length}</span></h3>
      <ol className="step-cards">{plan.steps.map((s, n) => {
        const st = steps[s.id] ?? { done: false, value: "" };
        const ok = inNorm(s, st.value);
        const ref = pageRef(s);
        return <li key={s.id} className={`step-card ${st.done ? "done" : ""} ${isNew(s) ? "is-new" : ""}`}>
          <div className="step-num">{st.done ? <CheckCircle2 size={22}/> : n + 1}</div>
          <div className="step-body">
            <p className="step-text">{s.text}</p>
            {s.measure && <div className={`measure ${ok === true ? "ok" : ok === false ? "bad" : ""}`}>
              <label>{s.measure.name}</label>
              <div className="measure-row">
                <input inputMode="decimal" value={st.value} placeholder="0" onChange={e => set(s.id, { value: e.target.value })}/>
                <span>{s.measure.unit}</span>
              </div>
              <small>{t("plan.norm")}: {normText(s)}{ok === true ? ` — ${t("plan.ok")}` : ok === false ? ` — ${t("plan.outOfNorm")}` : ""}</small>
            </div>}
            {ref && <button className="step-source" onClick={() => onOpen(ref)}>
              <img src={thumb(ref)} alt="" loading="lazy"/><span><BookOpen size={13}/> {ref.manual}, {t("page")} {ref.pdf_page}</span>
            </button>}
          </div>
          <button className="step-done" onClick={() => set(s.id, { done: !st.done })} aria-pressed={st.done}>
            {st.done ? <CheckCircle2 size={26}/> : <Circle size={26}/>}<span>{st.done ? t("plan.doneYes") : t("plan.doneNo")}</span>
          </button>
        </li>;
      })}</ol>
      <button className="button button-primary button-large" onClick={report}><Send size={17}/>{t("plan.report")}</button>
    </>}
  </section>;
}
