import type { ReactNode } from "react";
import { BookOpen, CheckCircle2, Circle, HardHat, Loader2, Package, Send, Sparkles, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PlanItem, WorkPlan } from "../../types/domain";
import { LiveProgress } from "../../components/ui/AgentProgress";
import { figureImage, pageImage, thumb, type PageRef } from "../../components/ui/SourceCards";
import { inNorm, normText, type PlanState, type StepState } from "./usePlan";

export function pageRef(item: PlanItem): PageRef | null {
  return item.manual_id && item.pdf_page
    ? { manual_id: item.manual_id, manual: item.manual ?? "", pdf_page: item.pdf_page, figures: item.figures }
    : null;
}

export function PlanStatus({ plan }: { plan: WorkPlan }) {
  const { t } = useTranslation();
  const label = { building: t("plan.status_building", "собирается"), ready: t("plan.status_ready", "готов"),
    failed: t("plan.status_failed", "ошибка") }[plan.status];
  return <span className={`badge ${plan.status === "ready" ? "success" : plan.status === "failed" ? "danger" : "info"}`}>
    {plan.status === "building" && <Loader2 size={12} className="spin"/>}{label}
  </span>;
}

/** What to prepare: tools, parts, safety. Preliminary items are marked; new ones flash. */
export function PrepList({ p, onOpen }: { p: PlanState; onOpen: (r: PageRef) => void }) {
  const { t } = useTranslation();
  const plan = p.plan!;
  const chips = (items: PlanItem[], icon: ReactNode) => items.map(i => {
    const ref = pageRef(i);
    return <li key={i.id} className={`prep-item ${i.preliminary ? "preliminary" : ""} ${p.isNew(i) ? "is-new" : ""}`}>
      {icon}<span>{i.text}</span>
      {i.preliminary ? <em>{t("plan.preliminary", "предварительно")}</em>
        : ref && <button className="cite-chip" onClick={() => onOpen(ref)}>📖 {ref.pdf_page}</button>}
      {p.isNew(i) && <strong className="new-badge"><Sparkles size={11}/>{t("plan.new", "новое")}</strong>}
    </li>;
  });
  if (!plan.tools.length && !plan.materials.length && !plan.safety.length) return null;
  return <div className="prep-grid">
    {plan.tools.length > 0 && <div><h3><Wrench size={16}/>{t("plan.tools", "Инструмент")}</h3><ul>{chips(plan.tools, <Wrench size={14}/>)}</ul></div>}
    {plan.materials.length > 0 && <div><h3><Package size={16}/>{t("plan.materials", "Запчасти и материалы")}</h3><ul>{chips(plan.materials, <Package size={14}/>)}</ul></div>}
    {plan.safety.length > 0 && <div><h3><HardHat size={16}/>{t("plan.safety", "Безопасность")}</h3><ul>{chips(plan.safety, <HardHat size={14}/>)}</ul></div>}
  </div>;
}

/** One step: text, measurement against the manual norm, the page picture, a big done toggle. */
export function StepCard({ item, n, state, setStep, onOpen, big = false, isNew = false }: {
  item: PlanItem; n: number; state: StepState; setStep: (patch: Partial<StepState>) => void;
  onOpen: (r: PageRef) => void; big?: boolean; isNew?: boolean;
}) {
  const { t } = useTranslation();
  const ok = inNorm(item, state.value);
  const ref = pageRef(item);
  return <li className={`step-card ${big ? "step-big" : ""} ${state.done ? "done" : ""} ${isNew ? "is-new" : ""}`}>
    <div className="step-num">{state.done ? <CheckCircle2 size={22}/> : n}</div>
    <div className="step-body">
      <p className="step-text">{item.text}</p>
      {item.measure && <div className={`measure ${ok === true ? "ok" : ok === false ? "bad" : ""}`}>
        <label>{item.measure.name}</label>
        <div className="measure-row">
          <input inputMode="decimal" value={state.value} placeholder="0" onChange={e => setStep({ value: e.target.value })}/>
          <span>{item.measure.unit}</span>
        </div>
        <small>{t("plan.norm", "Норма")}: {normText(item)}{ok === true ? ` — ${t("plan.ok", "в норме")}`
          : ok === false ? ` — ${t("plan.outOfNorm", "вне нормы")}` : ""}</small>
      </div>}
      {ref && (big
        ? <button className="step-figure" onClick={() => onOpen(ref)}>
            <img src={ref.figures ? figureImage(ref, 0, 900) : pageImage(ref, 900)} alt=""/>
            <span><BookOpen size={14}/> {ref.manual}, {t("page", "стр.")} {ref.pdf_page}</span>
          </button>
        : <button className="step-source" onClick={() => onOpen(ref)}>
            <img src={thumb(ref)} alt="" loading="lazy"/><span><BookOpen size={13}/> {ref.manual}, {t("page", "стр.")} {ref.pdf_page}</span>
          </button>)}
    </div>
    <button className="step-done" onClick={() => setStep({ done: !state.done })} aria-pressed={state.done}>
      {state.done ? <CheckCircle2 size={26}/> : <Circle size={26}/>}
      <span>{state.done ? t("plan.doneYes", "Сделано") : t("plan.doneNo", "Отметить")}</span>
    </button>
  </li>;
}

/** Text the mechanic sends back to the agent: what was done and measured. */
export function planReport(plan: WorkPlan, p: PlanState, t: (k: string, d: string) => string): string {
  const lines = plan.steps.map((s, i) => {
    const st = p.stepState(s.id);
    const value = st.value
      ? `, ${s.measure?.name}: ${st.value} ${s.measure?.unit} (${inNorm(s, st.value) ? t("plan.ok", "в норме") : t("plan.outOfNorm", "вне нормы")})`
      : "";
    return `${i + 1}. ${st.done ? "✓" : "—"} ${s.text.slice(0, 80)}${value}`;
  });
  return `${t("plan.reportHeader", "Результаты работ по плану:")}\n${lines.join("\n")}`;
}

/** Whole plan on one panel (detailed workspace). */
export default function PlanPanel({ p, onOpen, onReport }: {
  p: PlanState; onOpen: (r: PageRef) => void; onReport: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (!p.plan) return <section className="panel plan-panel"><p className="muted"><Loader2 size={14} className="spin"/> {t("plan.starting", "Готовлю рабочий план…")}</p></section>;
  const plan = p.plan;
  return <section className="panel plan-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">{t("plan.eyebrow", "РАБОЧИЙ ПЛАН")}</p><h2>{t("plan.title", "Что подготовить и что делать")}</h2></div>
      <PlanStatus plan={plan}/>
    </div>
    {plan.status === "building" && <div className="plan-live"><LiveProgress events={p.events.slice(-4)}/></div>}
    {plan.note && <p className="plan-note">{plan.note}</p>}
    <PrepList p={p} onOpen={onOpen}/>
    {plan.steps.length > 0 && <>
      <h3 className="steps-title">{t("plan.steps", "Шаги")} <span>{p.doneCount}/{plan.steps.length}</span></h3>
      <ol className="step-cards">{plan.steps.map((s, n) =>
        <StepCard key={s.id} item={s} n={n + 1} state={p.stepState(s.id)} setStep={patch => p.setStep(s.id, patch)}
          onOpen={onOpen} isNew={p.isNew(s)}/>)}</ol>
      <button className="button button-primary button-large" onClick={() => onReport(planReport(plan, p, t))}>
        <Send size={17}/>{t("plan.report", "Отправить результаты агенту")}</button>
    </>}
  </section>;
}
